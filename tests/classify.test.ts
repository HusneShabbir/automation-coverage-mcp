import { describe, expect, it } from 'vitest';
import { classifyFile } from '../src/discovery/classify.js';

describe('classifyFile', () => {
  it('classifies backend router, services, and wiring', () => {
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard-backend/src/service/router.ts',
      ),
    ).toBe('backend-router');
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard-backend/src/plugin.ts',
      ),
    ).toBe('backend-plugin');
    expect(
      classifyFile('workspaces/scorecard/plugins/scorecard/src/index.ts'),
    ).toBe('plugin-wiring');
  });

  it('classifies frontend pages vs components vs utils', () => {
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard/src/components/ScorecardPage/ScorecardPage.tsx',
      ),
    ).toBe('react-page');
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard/src/components/MetricGroupCard/StatusIcon.tsx',
      ),
    ).toBe('react-component');
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard/src/utils/formatMetricUnit.ts',
      ),
    ).toBe('unit-logic');
  });

  it('classifies tests, overlay metadata, and platform files', () => {
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard/src/utils/__tests__/formatMetricUnit.test.ts',
      ),
    ).toBe('unit-test');
    expect(
      classifyFile('workspaces/intelligent-assistant/e2e-tests/chat.test.ts'),
    ).toBe('e2e-test');
    expect(
      classifyFile(
        'workspaces/scorecard/plugins/scorecard/metadata/plugin.yaml',
      ),
    ).toBe('overlay-metadata');
    expect(classifyFile('helm/chart/templates/route.yaml')).toBe('platform');
  });
});
