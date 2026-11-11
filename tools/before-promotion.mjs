// The files as they were before the trial's changes became the production source (2026-11-11). The equivalence
// tests still run each rewritten routine against the routine it replaced, read from that commit.
import {execFileSync} from 'node:child_process';
export const beforePromotion=path=>execFileSync('git',['show','b8e418d2fe8297a97896efe2d6bc6931f37d1a9c:'+path],{cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:1<<28});
