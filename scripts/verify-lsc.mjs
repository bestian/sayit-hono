#!/usr/bin/env node
// Runs `lsc gen` + `lsc check --backend=dafny` per-file (not the built-in
// batched mode, which aborts the whole run on the first file's hard Dafny
// parse error instead of continuing to the rest of LemmaScript-files.txt).
//
// Gates on regression against a recorded baseline (BASELINE below), not on
// reaching 0 errors — several of these files have documented, currently
// unclosable gaps (regex, generics/Map, union-in-sequence; see each file's
// own "not lsc-verifiable" comments). A file whose bodies are `//@ extern`
// (sectionPatch.ts) reports "N verified" as accepted trusted contracts, not
// machine-checked proofs from the real implementation — that distinction
// matters for reading the output honestly, but for THIS script's purpose
// (catch regressions) the verified/error counts are still the signal: a
// drop means something changed under an axiom or a previously-passing
// proof, worth investigating either way.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifestPath = new URL('../LemmaScript-files.txt', import.meta.url);
const lines = readFileSync(manifestPath, 'utf8')
	.split('\n')
	.map((l) => l.trim())
	.filter(Boolean);

// file -> { verified, errors }. Update this when a file's verification
// state deliberately improves (or, rarely, is knowingly relaxed) — do not
// update it just to silence a failing run.
const BASELINE = {
	'src/utils/sectionUtils.ts': { verified: 0, errors: 19 },
	'src/utils/pagination.ts': { verified: 0, errors: 2 },
	'src/utils/speakerColor.ts': { verified: 4, errors: 1 },
	'src/utils/sectionPatch.ts': { verified: 4, errors: 0 },
};

function parseVerifiedErrors(output) {
	const verifierRun = output.match(/(\d+)\s+verified,\s+(\d+)\s+errors?/);
	if (verifierRun) return { verified: Number(verifierRun[1]), errors: Number(verifierRun[2]) };
	// Resolution/type-check or parse errors happen BEFORE Dafny's verifier
	// runs at all — no "N verified" line is ever printed, but the error
	// count is real and comparable (verified is implicitly 0).
	const preVerify = output.match(/(\d+)\s+(?:resolution\/type|parse)\s+errors?\s+detected/);
	if (preVerify) return { verified: 0, errors: Number(preVerify[1]) };
	return null;
}

let anyRegression = false;
let anyCrash = false;

for (const line of lines) {
	const [file] = line.split(/\s+/);
	process.stdout.write(`\n=== ${file} ===\n`);

	let genOutput = '';
	try {
		genOutput = execFileSync('npx', ['lsc', 'gen', '--backend=dafny', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		process.stdout.write(genOutput);
	} catch (err) {
		process.stdout.write(String(err.stdout ?? '') + String(err.stderr ?? ''));
		console.error(
			`  [verify-lsc] CRASH: ${file} failed at the extraction stage (before Dafny even ran) — likely an unsupported TS construct (e.g. spread syntax). Always worth fixing, unlike a documented Dafny-level gap.`,
		);
		anyCrash = true;
		continue;
	}

	let checkOutput = '';
	try {
		checkOutput = execFileSync('npx', ['lsc', 'check', '--backend=dafny', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (err) {
		checkOutput = String(err.stdout ?? '') + String(err.stderr ?? '');
	}
	process.stdout.write(checkOutput);

	const baseline = BASELINE[file];
	const current = parseVerifiedErrors(checkOutput);

	if (!baseline) {
		console.log(
			`  [verify-lsc] ${file}: no recorded baseline (new file?) — add one to BASELINE in this script once you know its expected verified/error split.`,
		);
		continue;
	}
	if (!current) {
		console.error(
			`  [verify-lsc] ${file}: could not parse a "N verified, M errors" line from output — treating as a regression (baseline was ${baseline.verified}/${baseline.errors}).`,
		);
		anyRegression = true;
		continue;
	}

	const worseVerified = current.verified < baseline.verified;
	const worseErrors = current.errors > baseline.errors;
	if (worseVerified || worseErrors) {
		console.error(
			`  [verify-lsc] REGRESSION in ${file}: baseline ${baseline.verified} verified / ${baseline.errors} errors -> now ${current.verified} verified / ${current.errors} errors.`,
		);
		anyRegression = true;
	} else if (current.verified > baseline.verified || current.errors < baseline.errors) {
		console.log(
			`  [verify-lsc] IMPROVED ${file}: baseline ${baseline.verified}/${baseline.errors} -> now ${current.verified}/${current.errors}. Update BASELINE in this script to lock it in.`,
		);
	} else {
		console.log(`  [verify-lsc] ${file}: matches baseline (${current.verified} verified / ${current.errors} errors).`);
	}
}

if (anyCrash || anyRegression) {
	console.error('\n[verify-lsc] FAILED — see CRASH/REGRESSION lines above.');
	process.exit(1);
}

console.log('\n[verify-lsc] OK — no file regressed below its recorded baseline.');
