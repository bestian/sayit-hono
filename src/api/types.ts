export type ApiEnv = {
	Bindings: {
		DB: D1Database;
		ASSETS: Fetcher;
		SPEECH_CACHE: R2Bucket;
		SEARCH_CLIENT_LIMIT: RateLimit;
		SEARCH_LOCATION_LIMIT: RateLimit;
		AUDREYT_TRANSCRIPT_TOKEN?: string;
		BESTIAN_TRANSCRIPT_TOKEN?: string;
		PROD_DATA_ORIGIN?: string;
	};
};
