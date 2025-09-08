/*
 * A fast javascript implementation of simplex noise by Jonas Wagner.
 *
 * Based on a speed-improved simplex noise algorithm for 2D, 3D and 4D in Java.
 * Which is based on example code by Ken Perlin.
 *
 * Permutation table construction borrowed from Stefan Gustavson's and Peter Eastman's code.
 *
 * @author Jonas Wagner | jonas.wagner@life.uni-leipzig.de | http://29a.ch/
 * @license MIT
 */
class SimplexNoise {
	constructor(randomOrSeed = Math.random) {
		const random = typeof randomOrSeed == 'function' ? randomOrSeed : this.alea(randomOrSeed);

		this.p = new Uint8Array(256);
		for (let i = 0; i < 256; i++) {
			this.p[i] = i;
		}

		let n;
		for (let i = 255; i > 0; i--) {
			n = Math.floor((i + 1) * random());
			const q = this.p[i];
			this.p[i] = this.p[n];
			this.p[n] = q;
		}

		this.perm = new Uint8Array(512);
		this.permMod12 = new Uint8Array(512);
		for (let i = 0; i < 512; i++) {
			this.perm[i] = this.p[i & 255];
			this.permMod12[i] = this.perm[i] % 12;
		}

		this.grad3 = new Float32Array([
			1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1,
			0, -1, -1,
		]);

		this.grad4 = new Float32Array([
			0, 1, 1, 1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1, 0, -1, 1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1, 1,
			0, 1, 1, 1, 0, 1, -1, 1, 0, -1, 1, 1, 0, -1, -1, -1, 0, 1, 1, -1, 0, 1, -1, -1, 0, -1, 1, -1, 0, -1, -1, 1, 1,
			0, 1, 1, 1, 0, -1, 1, -1, 0, 1, 1, -1, 0, -1, -1, 1, 0, 1, -1, 1, 0, -1, -1, -1, 0, 1, -1, -1, 0, -1, 1, 1, 1,
			0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1, 0, -1, 1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1, 0,
		]);

		// Common vars
		this.F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
		this.G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
		this.F3 = 1.0 / 3.0;
		this.G3 = 1.0 / 6.0;
		this.F4 = (Math.sqrt(5.0) - 1.0) / 4.0;
		this.G4 = (5.0 - Math.sqrt(5.0)) / 20.0;
	}

	alea(seed) {
		let s0 = 0;
		let s1 = 0;
		let s2 = 0;
		let c = 1;

		if (seed.length == 0) {
			seed = [+new Date()];
		}
		let mash = this.mash();
		s0 = mash(' ');
		s1 = mash(' ');
		s2 = mash(' ');

		for (let i = 0; i < seed.length; i++) {
			s0 -= mash(seed[i]);
			if (s0 < 0) {
				s0 += 1;
			}
			s1 -= mash(seed[i]);
			if (s1 < 0) {
				s1 += 1;
			}
			s2 -= mash(seed[i]);
			if (s2 < 0) {
				s2 += 1;
			}
		}
		mash = null;
		return function () {
			let t = 2091639 * s0 + c * 2.3283064365386963e-10; // 2^-32
			s0 = s1;
			s1 = s2;
			return (s2 = t - (c = t | 0));
		};
	}

	mash() {
		let n = 0xefc8249d;
		return function (data) {
			data = data.toString();
			for (let i = 0; i < data.length; i++) {
				n += data.charCodeAt(i);
				let h = 0.02519603282416938 * n;
				n = h >>> 0;
				h -= n;
				h *= n;
				n = h >>> 0;
				h -= n;
				n += h * 0x100000000; // 2^32
			}
			return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
		};
	}

	noise2D(x, y) {
		let n0, n1, n2; // Noise contributions from the three corners
		const s = (x + y) * this.F2; // Hairy factor for 2D
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const t = (i + j) * this.G2;
		const X0 = i - t; // Unskew the cell origin back to (x,y) space
		const Y0 = j - t;
		const x0 = x - X0; // The x,y distances from the cell origin
		const y0 = y - Y0;
		let i1, j1; // Offsets for second (middle) corner of simplex in (i,j) coords
		if (x0 > y0) {
			i1 = 1;
			j1 = 0;
		} else {
			i1 = 0;
			j1 = 1;
		}
		const x1 = x0 - i1 + this.G2; // Offsets for middle corner in (x,y) unskewed coords
		const y1 = y0 - j1 + this.G2;
		const x2 = x0 - 1.0 + 2.0 * this.G2; // Offsets for last corner in (x,y) unskewed coords
		const y2 = y0 - 1.0 + 2.0 * this.G2;
		const ii = i & 255;
		const jj = j & 255;
		const gi0 = this.permMod12[ii + this.perm[jj]];
		const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
		const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];
		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 < 0) n0 = 0.0;
		else {
			t0 *= t0;
			n0 = t0 * t0 * (this.grad3[gi0 * 3] * x0 + this.grad3[gi0 * 3 + 1] * y0);
		}
		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 < 0) n1 = 0.0;
		else {
			t1 *= t1;
			n1 = t1 * t1 * (this.grad3[gi1 * 3] * x1 + this.grad3[gi1 * 3 + 1] * y1);
		}
		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 < 0) n2 = 0.0;
		else {
			t2 *= t2;
			n2 = t2 * t2 * (this.grad3[gi2 * 3] * x2 + this.grad3[gi2 * 3 + 1] * y2);
		}
		return 70.0 * (n0 + n1 + n2);
	}

	noise3D(x, y, z) {
		let n0, n1, n2, n3; // Noise contributions from the four corners
		const s = (x + y + z) * this.F3; // Very nice and simple skew factor for 3D
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const k = Math.floor(z + s);
		const t = (i + j + k) * this.G3;
		const X0 = i - t; // Unskew the cell origin back to (x,y,z) space
		const Y0 = j - t;
		const Z0 = k - t;
		const x0 = x - X0; // The x,y,z distances from the cell origin
		const y0 = y - Y0;
		const z0 = z - Z0;
		let i1, j1, k1; // Offsets for second corner of simplex in (i,j,k) coords
		let i2, j2, k2; // Offsets for third corner of simplex in (i,j,k) coords
		if (x0 >= y0) {
			if (y0 >= z0) {
				i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
			} else if (x0 >= z0) {
				i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
			} else {
				i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
			}
		} else {
			if (y0 < z0) {
				i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
			} else if (x0 < z0) {
				i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
			} else {
				i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
			}
		}
		const x1 = x0 - i1 + this.G3;
		const y1 = y0 - j1 + this.G3;
		const z1 = z0 - k1 + this.G3;
		const x2 = x0 - i2 + 2.0 * this.G3;
		const y2 = y0 - j2 + 2.0 * this.G3;
		const z2 = z0 - k2 + 2.0 * this.G3;
		const x3 = x0 - 1.0 + 3.0 * this.G3;
		const y3 = y0 - 1.0 + 3.0 * this.G3;
		const z3 = z0 - 1.0 + 3.0 * this.G3;
		const ii = i & 255;
		const jj = j & 255;
		const kk = k & 255;
		const gi0 = this.permMod12[ii + this.perm[jj + this.perm[kk]]];
		const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]];
		const gi2 = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]];
		const gi3 = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]];
		let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
		if (t0 < 0) n0 = 0.0;
		else {
			t0 *= t0;
			n0 = t0 * t0 * (this.grad3[gi0 * 3] * x0 + this.grad3[gi0 * 3 + 1] * y0 + this.grad3[gi0 * 3 + 2] * z0);
		}
		let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
		if (t1 < 0) n1 = 0.0;
		else {
			t1 *= t1;
			n1 = t1 * t1 * (this.grad3[gi1 * 3] * x1 + this.grad3[gi1 * 3 + 1] * y1 + this.grad3[gi1 * 3 + 2] * z1);
		}
		let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
		if (t2 < 0) n2 = 0.0;
		else {
			t2 *= t2;
			n2 = t2 * t2 * (this.grad3[gi2 * 3] * x2 + this.grad3[gi2 * 3 + 1] * y2 + this.grad3[gi2 * 3 + 2] * z2);
		}
		let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
		if (t3 < 0) n3 = 0.0;
		else {
			t3 *= t3;
			n3 = t3 * t3 * (this.grad3[gi3 * 3] * x3 + this.grad3[gi3 * 3 + 1] * y3 + this.grad3[gi3 * 3 + 2] * z3);
		}
		return 32.0 * (n0 + n1 + n2 + n3);
	}

	noise4D(x, y, z, w) {
		let n0, n1, n2, n3, n4;
		const s = (x + y + z + w) * this.F4;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const k = Math.floor(z + s);
		const l = Math.floor(w + s);
		const t = (i + j + k + l) * this.G4;
		const X0 = i - t;
		const Y0 = j - t;
		const Z0 = k - t;
		const W0 = l - t;
		const x0 = x - X0;
		const y0 = y - Y0;
		const z0 = z - Z0;
		const w0 = w - W0;
		const c = (x0 > y0 ? 32 : 0) + (x0 > z0 ? 16 : 0) + (y0 > z0 ? 8 : 0) + (x0 > w0 ? 4 : 0) + (y0 > w0 ? 2 : 0) + (z0 > w0 ? 1 : 0);
		const i1 = (c & 1) ? 1 : 0, j1 = (c & 2) ? 1 : 0, k1 = (c & 4) ? 1 : 0, l1 = (c & 8) ? 1 : 0;
		const i2 = (c & 1) ? 1 : 0, j2 = (c & 2) ? 1 : 0, k2 = (c & 4) ? 1 : 0, l2 = (c & 8) ? 1 : 0;
		const i3 = (c & 1) ? 1 : 0, j3 = (c & 2) ? 1 : 0, k3 = (c & 4) ? 1 : 0, l3 = (c & 8) ? 1 : 0;
		const x1 = x0 - i1 + this.G4;
		const y1 = y0 - j1 + this.G4;
		const z1 = z0 - k1 + this.G4;
		const w1 = w0 - l1 + this.G4;
		const x2 = x0 - i2 + 2.0 * this.G4;
		const y2 = y0 - j2 + 2.0 * this.G4;
		const z2 = z0 - k2 + 2.0 * this.G4;
		const w2 = w0 - l2 + 2.0 * this.G4;
		const x3 = x0 - i3 + 3.0 * this.G4;
		const y3 = y0 - j3 + 3.0 * this.G4;
		const z3 = z0 - k3 + 3.0 * this.G4;
		const w3 = w0 - l3 + 3.0 * this.G4;
		const x4 = x0 - 1.0 + 4.0 * this.G4;
		const y4 = y0 - 1.0 + 4.0 * this.G4;
		const z4 = z0 - 1.0 + 4.0 * this.G4;
		const w4 = w0 - 1.0 + 4.0 * this.G4;
		const ii = i & 255, jj = j & 255, kk = k & 255, ll = l & 255;
		const gi0 = this.perm[ii + this.perm[jj + this.perm[kk + this.perm[ll]]]] % 32;
		const gi1 = this.perm[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1 + this.perm[ll + l1]]]] % 32;
		const gi2 = this.perm[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2 + this.perm[ll + l2]]]] % 32;
		const gi3 = this.perm[ii + i3 + this.perm[jj + j3 + this.perm[kk + k3 + this.perm[ll + l3]]]] % 32;
		const gi4 = this.perm[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1 + this.perm[ll + 1]]]] % 32;
		let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
		if (t0 < 0) n0 = 0.0;
		else {
			t0 *= t0;
			n0 = t0 * t0 * (this.grad4[gi0 * 4] * x0 + this.grad4[gi0 * 4 + 1] * y0 + this.grad4[gi0 * 4 + 2] * z0 + this.grad4[gi0 * 4 + 3] * w0);
		}
		let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
		if (t1 < 0) n1 = 0.0;
		else {
			t1 *= t1;
			n1 = t1 * t1 * (this.grad4[gi1 * 4] * x1 + this.grad4[gi1 * 4 + 1] * y1 + this.grad4[gi1 * 4 + 2] * z1 + this.grad4[gi1 * 4 + 3] * w1);
		}
		let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
		if (t2 < 0) n2 = 0.0;
		else {
			t2 *= t2;
			n2 = t2 * t2 * (this.grad4[gi2 * 4] * x2 + this.grad4[gi2 * 4 + 1] * y2 + this.grad4[gi2 * 4 + 2] * z2 + this.grad4[gi2 * 4 + 3] * w2);
		}
		let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
		if (t3 < 0) n3 = 0.0;
		else {
			t3 *= t3;
			n3 = t3 * t3 * (this.grad4[gi3 * 4] * x3 + this.grad4[gi3 * 4 + 1] * y3 + this.grad4[gi3 * 4 + 2] * z3 + this.grad4[gi3 * 4 + 3] * w3);
		}
		let t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
		if (t4 < 0) n4 = 0.0;
		else {
			t4 *= t4;
			n4 = t4 * t4 * (this.grad4[gi4 * 4] * x4 + this.grad4[gi4 * 4 + 1] * y4 + this.grad4[gi4 * 4 + 2] * z4 + this.grad4[gi4 * 4 + 3] * w4);
		}
		return 27.0 * (n0 + n1 + n2 + n3 + n4);
	}
}
