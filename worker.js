// Import the noise library
importScripts('simplex-noise.js');

// --- Main Worker Entry Point ---
self.onmessage = (e) => {
    const params = e.data;
    const simplex = new SimplexNoise(params.seed.toString());

    // 1. Generate Height Map
    const heightMap = generateHeightMap(params, simplex);

    // 2. Generate Planet Texture
    const colormapData = generatePlanetTexture(params, heightMap, simplex);

    // 3. Create Heightmap visual data
    const heightmapVisualData = new Uint8ClampedArray(params.width * params.height * 4);
    for (let i = 0; i < heightMap.length; i++) {
        const val = Math.floor(heightMap[i] * 255);
        heightmapVisualData[i * 4] = val;
        heightmapVisualData[i * 4 + 1] = val;
        heightmapVisualData[i * 4 + 2] = val;
        heightmapVisualData[i * 4 + 3] = 255;
    }
    
    // Post results back to the main thread
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

function generateHeightMap(params, simplex) {
    const { width, height, scale, octaves, crater_scale, crater_strength } = params;
    const heightMap = new Float32Array(width * height);
    
    let minVal = Infinity, maxVal = -Infinity;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const sp = mapToSphere(x, y, width, height);
            
            // FBM for base terrain
            let baseNoise = 0;
            let freq = scale / 100;
            let amp = 1;
            for (let o = 0; o < octaves; o++) {
                baseNoise += simplex.noise3D(sp.x * freq, sp.y * freq, sp.z * freq) * amp;
                freq *= 2.0; // Lacunarity
                amp *= 0.5;  // Persistence
            }

            // Crater noise
            const craterNoiseRaw = simplex.noise3D(
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

    // Normalize height map
    const range = maxVal - minVal;
    if (range > 0) {
        for (let i = 0; i < heightMap.length; i++) {
            heightMap[i] = (heightMap[i] - minVal) / range;
        }
    }
    
    return heightMap;
}


function generatePlanetTexture(params, heightMap, simplex) {
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

            const perturbVal = simplex.noise2D(sp.x * 300, sp.y * 300) * perturb_strength;
            
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

    // Ensure coordinates are positive
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
