import { describe, expect, it } from 'vitest';
import { isAuthorizedFromHeader, verifyTranscriptToken } from '../src/api/auth';

describe('verifyTranscriptToken', () => {
	it('false when provided is empty/null/undefined', async () => {
		expect(await verifyTranscriptToken(null, 'a', 'b')).toBe(false);
		expect(await verifyTranscriptToken(undefined, 'a', 'b')).toBe(false);
		expect(await verifyTranscriptToken('', 'a', 'b')).toBe(false);
	});

	it('false when no allowed tokens are configured', async () => {
		expect(await verifyTranscriptToken('something')).toBe(false);
		expect(await verifyTranscriptToken('something', undefined)).toBe(false);
		expect(await verifyTranscriptToken('something', '')).toBe(false);
		expect(await verifyTranscriptToken('something', null, undefined)).toBe(false);
	});

	it('true when provided matches the first allowed token', async () => {
		expect(await verifyTranscriptToken('audrey-secret', 'audrey-secret', 'bestian-secret')).toBe(true);
	});

	it('true when provided matches the second allowed token (no short-circuit on first)', async () => {
		expect(await verifyTranscriptToken('bestian-secret', 'audrey-secret', 'bestian-secret')).toBe(true);
	});

	it('false when provided matches neither', async () => {
		expect(await verifyTranscriptToken('wrong', 'audrey-secret', 'bestian-secret')).toBe(false);
	});

	it('treats undefined/empty allowed tokens as absent and still finds a match among the rest', async () => {
		expect(await verifyTranscriptToken('only-real', undefined, 'only-real', '')).toBe(true);
	});
});

describe('isAuthorizedFromHeader', () => {
	it('false on missing header', async () => {
		expect(await isAuthorizedFromHeader(null, 'a', 'b')).toBe(false);
		expect(await isAuthorizedFromHeader(undefined, 'a', 'b')).toBe(false);
		expect(await isAuthorizedFromHeader('', 'a', 'b')).toBe(false);
	});

	it('false on non-Bearer scheme', async () => {
		expect(await isAuthorizedFromHeader('Basic abc', 'a', 'b')).toBe(false);
		expect(await isAuthorizedFromHeader('Bearer', 'a', 'b')).toBe(false);
	});

	it('false on Bearer with empty token (just whitespace stripped is still empty)', async () => {
		expect(await isAuthorizedFromHeader('Bearer ', 'a', 'b')).toBe(false);
	});

	it('true on Bearer with a matching token', async () => {
		expect(await isAuthorizedFromHeader('Bearer secret', 'secret', 'other')).toBe(true);
	});

	it('false on Bearer with a non-matching token', async () => {
		expect(await isAuthorizedFromHeader('Bearer wrong', 'secret', 'other')).toBe(false);
	});
});
