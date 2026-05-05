/**
 * Bearer token 驗證：constant-time（不依賴第幾個 token 命中）的 SHA-256
 * 雜湊比對。把對 `===` / `!==` 的時間差攻擊面降到只剩 hash 一致時的
 * byte-XOR fold——而 fold 走滿整段 32 bytes 不 short-circuit。
 *
 * 為什麼不是直接 string compare：JS 字串相等比對在 V8 / workerd 上
 * 可能依長度短路、依首字元短路。理論上的 timing 訊息都不應該洩漏給
 * 攻擊者，即使網路 jitter 通常會蓋掉這個差。
 */

const enc = new TextEncoder();

async function sha256(input: string): Promise<Uint8Array> {
	const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
	return new Uint8Array(buf);
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	// 不 branch on length：用 XOR fold 同時把長度差也算進去，不同長度直接得到非零 diff。
	let diff = a.length ^ b.length;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/**
 * 對 `provided` 與每一個 non-empty allowed token 都做 SHA-256 + XOR fold。
 * 一定會跑完全部 allowed（不 short-circuit）以維持 timing 與第幾個命中無關。
 */
export async function verifyTranscriptToken(
	provided: string | null | undefined,
	...allowed: Array<string | null | undefined>
): Promise<boolean> {
	if (!provided) return false;
	const validAllowed = allowed.filter(
		(t): t is string => typeof t === 'string' && t.length > 0
	);
	if (validAllowed.length === 0) return false;

	const providedHash = await sha256(provided);
	let matched = false;
	for (const candidate of validAllowed) {
		const candidateHash = await sha256(candidate);
		// 不 break：即使早早命中，也跑完所有 candidate 維持定常時間
		if (constantTimeBytesEqual(providedHash, candidateHash)) matched = true;
	}
	return matched;
}

/**
 * 解析 `Authorization: Bearer <token>`，再呼叫 verifyTranscriptToken。
 * Header 缺失或不是 Bearer 直接 false——那一路徑與 token 比對 timing
 * 沒關係（攻擊者必須先給 valid Bearer 格式才會走到 hash 比對）。
 */
export async function isAuthorizedFromHeader(
	authHeader: string | null | undefined,
	audreytToken: string | null | undefined,
	bestianToken: string | null | undefined
): Promise<boolean> {
	if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
	const token = authHeader.slice(7);
	return verifyTranscriptToken(token, audreytToken, bestianToken);
}
