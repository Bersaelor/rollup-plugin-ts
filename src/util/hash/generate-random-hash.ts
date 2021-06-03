import {createHmac, randomBytes} from "crypto";

export interface GenerateRandomHashOptions {
	key: string;
	length: number;
}

/**
 * Generates a random hash
 */
export function generateRandomHash({length = 8, key}: Partial<GenerateRandomHashOptions> = {}): string {
	return key == null ? randomBytes(length / 2).toString("hex") : createHmac("sha1", key).digest("hex").slice(0, length);
}

export function generateRandomIntegerHash(options?: Partial<GenerateRandomHashOptions>, offset = 1000000): number {
	const str = generateRandomHash(options);

	let result = 0;
	for (let i = 0; i < str.length; i++) {
		result = result + str.charCodeAt(i);
	}

	return result + offset;
}

export interface RandomPathOptions {
	extension: string;
	prefix: string;
	suffix: string;
}
export function generateRandomPath({extension = "", prefix = "__#auto-generated-", suffix = String(Math.floor(Math.random() * 100000))}: Partial<RandomPathOptions> = {}) {
	return `${prefix}${suffix}${extension}`;
}
