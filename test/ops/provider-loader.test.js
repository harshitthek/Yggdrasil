import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PROJECT_ROOT = path.resolve(process.cwd());

function runBash(script) {
  const tempFileName = `.temp-test-${Date.now()}-${Math.random().toString(36).substring(7)}.sh`;
  const tempFilePath = path.join(PROJECT_ROOT, tempFileName);
  try {
    fs.writeFileSync(tempFilePath, script, 'utf-8');
    return execSync(`bash "${tempFileName}"`, { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: 'pipe' });
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

function runBashCatch(script) {
  try {
    runBash(script);
    return { success: true, output: '' };
  } catch (error) {
    return {
      success: false,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
    };
  }
}

describe('Operations SDK - Provider Loader', () => {
  it('should load template.sh correctly and expose PROVIDER_API=1', () => {
    const output = runBash('source ops/lib/providers/template.sh && echo -e "$PROVIDER_API\\n$(provider_name)"')
      .trim()
      .split('\n');

    assert.equal(output[0], '1');
    assert.equal(output[1], 'template');
  });

  it('should fail elegantly if provider is completely missing', () => {
    // We mock config.sh by explicitly overriding OPS_PROVIDER before calling common.sh
    const result = runBashCatch('export OPS_PROVIDER=doesnotexist && source ops/lib/common.sh');

    assert.equal(result.success, false);
    assert.ok(result.output.includes('not found'), 'Should log a not found error');
  });

  it('should fail elegantly if PROVIDER_API is incorrect', () => {
    // Create a temporary bad provider
    const badProviderPath = path.join(PROJECT_ROOT, 'ops', 'lib', 'providers', 'badapi.sh');
    fs.writeFileSync(badProviderPath, '#!/usr/bin/env bash\nexport PROVIDER_API=999\n', 'utf-8');

    let result;
    try {
      result = runBashCatch('export OPS_PROVIDER=badapi && source ops/lib/common.sh');
    } finally {
      if (fs.existsSync(badProviderPath)) fs.unlinkSync(badProviderPath);
    }

    assert.equal(result.success, false);
    assert.ok(result.output.includes('requires API version'), 'Should log API version error');
    assert.ok(result.output.includes('expected 1'), 'Should mention expected API version');
  });
});
