export type ApiEnv = {
	Bindings: {
		DB: D1Database;
		ASSETS: Fetcher;
		SPEECH_CACHE: R2Bucket;
		SEARCH_BUDGET: DurableObjectNamespace<import('../search/budgetObject').SearchBudget>;
		AUDREYT_TRANSCRIPT_TOKEN?: string;
		BESTIAN_TRANSCRIPT_TOKEN?: string;
		PROD_DATA_ORIGIN?: string;
	};
};
