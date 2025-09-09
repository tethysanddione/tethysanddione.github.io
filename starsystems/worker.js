// 1. 使用 CDN 的 ES 模块导入，取代 importScripts()
import { createNoise2D, createNoise3D } from 'https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js';

// 2. 引入一个种子随机数生成器 (PRNG)，确保结果可复现
// This is a simple but effective PRNG called 'alea'.
function Alea(seed) {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let c = 1;

  const mash = (data) => {
    data = data.toString();
    let n = 0xefc8249d;
    for (let i = 0; i < data.length; i++) {
        n += data.charCodeAt(i);
        let h = 0.02519603282416938 * n;
        n = h >>> 0;
        h -= n;
        h *= n;
        n = h >>> 0;
        h -= n;
        n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };

  s0 = mash(' ');
  s1 = mash(' ');
  s2 = mash(' ');

  s0 -= mash(seed);
  if (s0 < 0) { s0 += 1; }
  s1 -= mash(seed);
  if (s1 < 0) { s1 += 1; }
  s2 -= mash(seed);
  if (s2 < 0) { s2 += 1; }

  return function() {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10; // 2^-32
    s0 = s1;
    s1 = s2;
    return s2 = t - (c = t | 0);
  };
}


// --- Main Worker Entry Point ---
self.onmessage = (e) => {
    const params = e.data;
    
    // 3. 根据新库的用法，创建 noise2D 和 noise3D 函数
    const seededRandom = Alea(params.seed.toString());
    const noise2D = createNoise2D(seededRandom);
    const noise3D = createNoise3D(seededRandom);

    // 1. Generate Height Map
    const heightMap = generateHeightMap(params, noise3D, seededRandom); // Pass PRNG for craters

    // 2. Generate Planet Texture
    const colormapData = generatePlanetTexture(params, heightMap, noise2D);

    // 3. Create Heightmap visual data
    const heightmapVisualData = new Uint8ClampedArray(params.width * params.height * 4);
    for (let i = 0; i < heightMap.length; i++) {
        const val = Math.floor(heightMap[i] * 255);
        heightmapVisualData[i * 4] = val;
        heightmapVisualData[i * 4 + 1] = val;
        heightmapVisualData[i * 4 + 2] = val;
        heightmapVisualData[i * 4 + 3] = 255;
    }
    
    self.postMessage({
        colormapData: colormapData.buffer,
        heightmapData: heightmapVisualData.buffer,
        width: params.width,
        height: params.height,
    }, [colormapData.buffer, heightmapVisualData.buffer]);
};


// --- Core Generation Logic ---

function mapToSphere(x, y, width, height) {
    const lonRad = (x / width) * 2 * Math.PI;

    // 引入一个拉伸因子来调整赤道附近的比例
    // 0.5 到 1.0 之间的值通常效果较好，越小越平坦
    const stretchFactor = 0.65; // 你可以调整这个值

    // 根据拉伸因子调整 y 的贡献，使其更均匀
    const adjustedY = (y / height - 0.5) * stretchFactor + 0.5;
    
    // 使用调整后的 y 值来计算纬度
    const latRad = Math.acos(1 - 2 * adjustedY) - Math.PI / 2;
    
    const sphereX = Math.cos(latRad) * Math.cos(lonRad);
    const sphereY = Math.cos(latRad) * Math.sin(lonRad);
    const sphereZ = Math.sin(latRad);
    
    return { x: sphereX, y: sphereY, z: sphereZ };
}

function generateHeightMap(params, noise3D, prng) {
    const { width, height, scale, octaves, crater_scale, crater_strength } = params;
    const heightMap = new Float32Array(width * height);

    // ---- 陨石坑 profile ----
    function craterProfile(r, depth) {
        if (r > 1.0) return 0;
        // A more realistic profile with a central peak
        const depression = -depth * Math.exp(-Math.pow(r * 3, 2));
        const rim = depth * 0.4 * Math.exp(-Math.pow((r - 0.9) * 5, 2));
        return depression + rim;
    }

    // ---- 随机生成坑中心 ----
    const numCraters = Math.floor(crater_scale * 50);
    const craters = [];
    for (let i = 0; i < numCraters; i++) {
        const u = prng() * 2 - 1;
        const theta = prng() * 2 * Math.PI;
        const r = Math.sqrt(1 - u * u);
        const center = { x: r * Math.cos(theta), y: r * Math.sin(theta), z: u };

        craters.push({
            center,
            radius: 0.02 + prng() * 0.08,
            depth: crater_strength * (0.5 + prng())
        });
    }

    let minVal = Infinity, maxVal = -Infinity;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const sp = mapToSphere(x, y, width, height);

            // ---- 基础噪声 ----
            let baseNoise = 0;
            let freq = scale / 100;
            let amp = 1;
            for (let o = 0; o < octaves; o++) {
                baseNoise += noise3D(sp.x * freq, sp.y * freq, sp.z * freq) * amp;
                freq *= 2.0;
                amp *= 0.5;
            }

            // ---- 陨石坑效果 ----
            let craterEffect = 0;
            for (const crater of craters) {
                const dx = sp.x - crater.center.x;
                const dy = sp.y - crater.center.y;
                const dz = (sp.z - crater.center.z);
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                const r = dist / crater.radius;
                if (r <= 1.2) { // Slightly larger radius for rim effect
                    craterEffect += craterProfile(r, crater.depth);
                }
            }

            const finalHeight = baseNoise + craterEffect;
            heightMap[i] = finalHeight;

            if (finalHeight < minVal) minVal = finalHeight;
            if (finalHeight > maxVal) maxVal = finalHeight;
        }
    }

    // ---- 归一化 ----
    const range = maxVal - minVal;
    if (range > 1e-6) {
        for (let i = 0; i < heightMap.length; i++) {
            heightMap[i] = (heightMap[i] - minVal) / range;
        }
    }

    return heightMap;
}


function generatePlanetTexture(params, heightMap, noise2D) {
    // 解构出所有需要的参数，包括新的纹理和混合参数
    const { 
        width, height, 
        textureDataBase, textureDataHigh,
        blend_altitude, blend_smoothness,
        texture_world_scale, perturb_strength, shading_strength 
    } = params;

    const colorMap = new Uint8ClampedArray(width * height * 4);
    
    const lightVec = { x: 1.0, y: 0.5, z: 0.5 };
    const lightMag = Math.sqrt(lightVec.x**2 + lightVec.y**2 + lightVec.z**2);
    lightVec.x /= lightMag; lightVec.y /= lightMag; lightVec.z /= lightMag;

    const { gx, gy } = calculateGradient(heightMap, width, height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const h = heightMap[i]; // 当前点的高度 (0-1)
            const sp = mapToSphere(x, y, width, height);

            const weights = { x: Math.abs(sp.x), y: Math.abs(sp.y), z: Math.abs(sp.z) };
            const sum_weights = weights.x + weights.y + weights.z;
            weights.x /= sum_weights; weights.y /= sum_weights; weights.z /= sum_weights;

            const perturbVal = noise2D(sp.x * 300, sp.y * 300) * perturb_strength;
            
            // --- 核心修改: 双纹理混合 ---
            
            // 1. 获取基础纹理(低海拔)的颜色
            const mixedColorBase = getTriplanarColor(sp, textureDataBase, texture_world_scale, perturbVal, weights);
            let finalColor = mixedColorBase;

            // 2. 如果有高海拔纹理，则进行混合
            if (textureDataHigh) {
                const mixedColorHigh = getTriplanarColor(sp, textureDataHigh, texture_world_scale, perturbVal, weights);

                // 3. 根据高度计算混合因子
                const edge0 = blend_altitude - blend_smoothness;
                const edge1 = blend_altitude + blend_smoothness;
                const mixFactor = smoothstep(edge0, edge1, h);
                
                // 4. 混合两种颜色
                finalColor = {
                    r: lerp(mixedColorBase.r, mixedColorHigh.r, mixFactor),
                    g: lerp(mixedColorBase.g, mixedColorHigh.g, mixFactor),
                    b: lerp(mixedColorBase.b, mixedColorHigh.b, mixFactor),
                };
            }

            // --- 混合结束 ---

            const surfaceNormal = { x: -gx[i] * shading_strength * 100, y: -gy[i] * shading_strength * 100, z: 1 };
            const mag = Math.sqrt(surfaceNormal.x**2 + surfaceNormal.y**2 + surfaceNormal.z**2);
            surfaceNormal.x /= mag; surfaceNormal.y /= mag; surfaceNormal.z /= mag;

            const dot = surfaceNormal.x * lightVec.x + surfaceNormal.y * lightVec.y + surfaceNormal.z * lightVec.z;
            const shading = 0.6 + 0.4 * Math.max(0, dot);
            
            colorMap[i * 4] = finalColor.r * shading;
            colorMap[i * 4 + 1] = finalColor.g * shading;
            colorMap[i * 4 + 2] = finalColor.b * shading;
            colorMap[i * 4 + 3] = 255;
        }
    }
    return colorMap;
}

// --- Helper Functions ---

function lerp(a, b, t) {
    return a * (1 - t) + b * t;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function getTriplanarColor(sp, textureData, texture_world_scale, perturbVal, weights) {
    const texWidth = textureData.width;
    const texHeight = textureData.height;
    
    const coords = {
        x: {
            u: (sp.y * texWidth * texture_world_scale + perturbVal),
            v: (sp.z * texHeight * texture_world_scale + perturbVal),
        },
        y: {
            u: (sp.x * texWidth * texture_world_scale + perturbVal),
            v: (sp.z * texHeight * texture_world_scale + perturbVal),
        },
        z: {
            u: (sp.x * texWidth * texture_world_scale + perturbVal),
            v: (sp.y * texHeight * texture_world_scale + perturbVal),
        }
    };

    const colorX = sampleTextureBilinear(textureData, coords.x.u, coords.x.v);
    const colorY = sampleTextureBilinear(textureData, coords.y.u, coords.y.v);
    const colorZ = sampleTextureBilinear(textureData, coords.z.u, coords.z.v);
    
    return {
        r: colorX.r * weights.x + colorY.r * weights.y + colorZ.r * weights.z,
        g: colorX.g * weights.x + colorY.g * weights.y + colorZ.g * weights.z,
        b: colorX.b * weights.x + colorY.b * weights.y + colorZ.b * weights.z,
    };
}


function calculateGradient(data, width, height) {
    const gx = new Float32Array(data.length);
    const gy = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            // Use wrapped (toroidal) sampling for seamless gradients at edges
            const x_prev = (x === 0) ? width - 1 : x - 1;
            const x_next = (x === width - 1) ? 0 : x + 1;
            const y_prev = (y === 0) ? height - 1 : y - 1;
            const y_next = (y === height - 1) ? 0 : y + 1;

            const x1 = data[y * width + x_prev];
            const x2 = data[y * width + x_next];
            const y1 = data[y_prev * width + x];
            const y2 = data[y_next * width + x];
            
            gx[i] = (x2 - x1);
            gy[i] = (y2 - y1);
        }
    }
    return { gx, gy };
}

function sampleTextureBilinear(textureData, u, v) {
    const texWidth = textureData.width;
    const texHeight = textureData.height;

    // Ensure u and v are positive for modulo operations
    u = u < 0 ? (u % texWidth) + texWidth : u;
    v = v < 0 ? (v % texHeight) + texHeight : v;

    const x = Math.floor(u);
    const y = Math.floor(v);
    const u_ratio = u - x;
    const v_ratio = v - y;
    const u_opposite = 1 - u_ratio;
    const v_opposite = 1 - v_ratio;

    const getPixel = (px, py) => {
        const index = ((py % texHeight) * texWidth + (px % texWidth)) * 4;
        return {
            r: textureData.data[index],
            g: textureData.data[index + 1],
            b: textureData.data[index + 2],
        };
    };

    const c1 = getPixel(x, y);
    const c2 = getPixel(x + 1, y);
    const c3 = getPixel(x, y + 1);
    const c4 = getPixel(x + 1, y + 1);

    const r = (c1.r * u_opposite + c2.r * u_ratio) * v_opposite + (c3.r * u_opposite + c4.r * u_ratio) * v_ratio;
    const g = (c1.g * u_opposite + c2.g * u_ratio) * v_opposite + (c3.g * u_opposite + c4.g * u_ratio) * v_ratio;
    const b = (c1.b * u_opposite + c2.b * u_ratio) * v_opposite + (c3.b * u_opposite + c4.b * u_ratio) * v_ratio;

    return { r, g, b };
}
