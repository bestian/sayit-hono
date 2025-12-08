export type ApiEnv = {
	Bindings: {
		DB: D1Database;
		ASSETS: Fetcher;
		SPEECH_AN: R2Bucket;
		AUDREYT_TRANSCRIPT_TOKEN?: string;
		BESTIAN_TRANSCRIPT_TOKEN?: string;
	};
};

