import * as THREE from 'three';
import type { DecodedImage } from '#lib/image/decode';

export function dataTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
	const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.minFilter = texture.magFilter = THREE.LinearFilter;
	texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	// Current shaders work in source-byte colour space. Feedback must not decode sRGB.
	texture.colorSpace = THREE.NoColorSpace;
	texture.needsUpdate = true;
	return texture;
}

export function photoTexture(image: DecodedImage): THREE.DataTexture {
	const { width, height, imageData } = image;
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		pixels.set(imageData.data.subarray(y * width * 4, (y + 1) * width * 4),
			(height - y - 1) * width * 4);
	}
	return dataTexture(pixels, width, height);
}

export function renderTarget(width: number, height: number): THREE.WebGLRenderTarget {
	return new THREE.WebGLRenderTarget(width, height, {
		minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
		depthBuffer: false, stencilBuffer: false, generateMipmaps: false
	});
}

/** Bounded feedback storage, owned and disposed by the engine using it. */
export class FeedbackBuffer {
	read: THREE.WebGLRenderTarget;
	write: THREE.WebGLRenderTarget;
	dirty = true;

	constructor(width: number, height: number) {
		this.read = renderTarget(width, height);
		this.write = renderTarget(width, height);
	}

	resize(width: number, height: number): void {
		if (this.read.width === width && this.read.height === height) return;
		this.read.setSize(width, height);
		this.write.setSize(width, height);
		this.reset();
	}

	reset(): void { this.dirty = true; }

	clear(renderer: THREE.WebGLRenderer): void {
		const target = renderer.getRenderTarget();
		try {
			for (const buffer of [this.read, this.write]) {
				renderer.setRenderTarget(buffer);
				renderer.clear();
			}
			this.dirty = false;
		} finally {
			renderer.setRenderTarget(target);
		}
	}

	swap(): void { [this.read, this.write] = [this.write, this.read]; }
	dispose(): void { this.read.dispose(); this.write.dispose(); }
}
