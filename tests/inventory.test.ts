import { describe, expect, it } from 'vitest';
import { extractTestTitles } from '../src/inventory/tests.js';

describe('extractTestTitles', () => {
  it('reads describe and test titles', () => {
    const source = `
describe('formatWithMetricUnit', () => {
  it('adds a space before alphabetic units', () => {});
  test.skip('pending', () => {});
});
test.describe('Scorecard page', () => {
  test('renders empty state', async ({ page }) => {});
});
`;
    const titles = extractTestTitles(source).map(t => t.title);
    expect(titles).toContain('formatWithMetricUnit');
    expect(titles).toContain('adds a space before alphabetic units');
    expect(titles).toContain('Scorecard page');
    expect(titles).toContain('renders empty state');
  });
});
