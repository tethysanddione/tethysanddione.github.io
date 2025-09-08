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
    const heightMap = generateHeightMap(params, noise3D);

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
    const latRad = (y / height) * Math.PI - Math.PI / 2;
    
    const sphereX = Math.cos(latRad) * Math.cos(lonRad);
    const sphereY = Math.cos(latRad) * Math.sin(lonRad);
    const sphereZ = Math.sin(latRad);
    
    return { x: sphereX, y: sphereY, z: sphereZ };
}

function generateHeightMap(params, noise3D) { // 4. 将 simplex 替换为 noise3D
    const { width, height, scale, octaves, crater_scale, crater_strength } = params;
    const heightMap = new Float32Array(width * height);
    
    let minVal = Infinity, maxVal = -Infinity;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const sp = mapToSphere(x, y, width, height);
            
            let baseNoise = 0;
            let freq = scale / 100;
            let amp = 1;
            for (let o = 0; o < octaves; o++) {
                baseNoise += noise3D(sp.x * freq, sp.y * freq, sp.z * freq) * amp;
                freq *= 2.0;
                amp *= 0.5;
            }

            const craterNoiseRaw = noise3D(
                sp.x * crater_scale / 100 + 100,
                sp.y * crater_scale / 100 + 100,
                sp.z * crater_scale / 100 + 100
            );
            let craterNoise = 1.0 - (craterNoiseRaw + 1.0) / 2.0;
            craterNoise = Math.pow(craterNoise, 4) * crater_strength;

            const finalHeight = baseNoise - craterNoise;
            heightMap[i] = finalHeight;

            if (finalHeight < minVal) minVal = finalHeight;
            if (finalHeight > maxVal) maxVal = finalHeight;
        }
    }

    const range = maxVal - minVal;
    if (range > 0) {
        for (let i = 0; i < heightMap.length; i++) {
            heightMap[i] = (heightMap[i] - minVal) / range;
        }
    }
    
    return heightMap;
}


function generatePlanetTexture(params, heightMap, noise2D) { // 4. 将 simplex 替换为 noise2D
    const { width, height, textureData, texture_world_scale, perturb_strength, shading_strength } = params;
    const colorMap = new Uint8ClampedArray(width * height * 4);
    
    const texWidth = textureData.width;
    const texHeight = textureData.height;
    
    const lightVec = { x: 1.0, y: 0.5, z: 0.5 };
    const lightMag = Math.sqrt(lightVec.x**2 + lightVec.y**2 + lightVec.z**2);
    lightVec.x /= lightMag; lightVec.y /= lightMag; lightVec.z /= lightMag;

    const { gx, gy } = calculateGradient(heightMap, width, height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const sp = mapToSphere(x, y, width, height);

            const weights = { x: Math.abs(sp.x), y: Math.abs(sp.y), z: Math.abs(sp.z) };
            const sum_weights = weights.x + weights.y + weights.z;
            weights.x /= sum_weights; weights.y /= sum_weights; weights.z /= sum_weights;

            const perturbVal = noise2D(sp.x * 300, sp.y * 300) * perturb_strength;
            
            const coords = {
                x: {
                    u: (sp.y * texWidth * texture_world_scale + perturbVal) % texWidth,
                    v: (sp.z * texHeight * texture_world_scale + perturbVal) % texHeight,
                },
                y: {
                    u: (sp.x * texWidth * texture_world_scale + perturbVal) % texWidth,
                    v: (sp.z * texHeight * texture_world_scale + perturbVal) % texHeight,
                },
                z: {
                    u: (sp.x * texWidth * texture_world_scale + perturbVal) % texWidth,
                    v: (sp.y * texHeight * texture_world_scale + perturbVal) % texHeight,
                }
            };

            const colorX = sampleTextureBilinear(textureData, coords.x.u, coords.x.v);
            const colorY = sampleTextureBilinear(textureData, coords.y.u, coords.y.v);
            const colorZ = sampleTextureBilinear(textureData, coords.z.u, coords.z.v);
            
            const mixedColor = {
                r: colorX.r * weights.x + colorY.r * weights.y + colorZ.r * weights.z,
                g: colorX.g * weights.x + colorY.g * weights.y + colorZ.g * weights.z,
                b: colorX.b * weights.x + colorY.b * weights.y + colorZ.b * weights.z,
            };

            const surfaceNormal = { x: -gx[i] * shading_strength, y: -gy[i] * shading_strength, z: 0.1 };
            const mag = Math.sqrt(surfaceNormal.x**2 + surfaceNormal.y**2 + surfaceNormal.z**2);
            surfaceNormal.x /= mag; surfaceNormal.y /= mag; surfaceNormal.z /= mag;

            const dot = surfaceNormal.x * lightVec.x + surfaceNormal.y * lightVec.y + surfaceNormal.z * lightVec.z;
            const shading = 0.6 + 0.4 * Math.max(0, dot);
            
            colorMap[i * 4] = mixedColor.r * shading;
            colorMap[i * 4 + 1] = mixedColor.g * shading;
            colorMap[i * 4 + 2] = mixedColor.b * shading;
            colorMap[i * 4 + 3] = 255;
        }
    }
    return colorMap;
}

// --- Helper Functions ---

function calculateGradient(data, width, height) {
    const gx = new Float32Array(data.length);
    const gy = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const x1 = data[y * width + (x > 0 ? x - 1 : x)];
            const x2 = data[y * width + (x < width - 1 ? x + 1 : x)];
            const y1 = data[(y > 0 ? y - 1 : y) * width + x];
            const y2 = data[(y < height - 1 ? y + 1 : y) * width + x];
            gx[i] = (x2 - x1) / 2;
            gy[i] = (y2 - y1) / 2;
        }
    }
    return { gx, gy };
}

function sampleTextureBilinear(textureData, u, v) {
    const texWidth = textureData.width;
    const texHeight = textureData.height;

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
