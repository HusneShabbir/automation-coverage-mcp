import { describe, expect, it } from 'vitest';
import { parseUnifiedDiffAccurate } from '../src/git/diff.js';

const DIFF = `diff --git a/src/utils/format.ts b/src/utils/format.ts
index 111..222 100644
--- a/src/utils/format.ts
+++ b/src/utils/format.ts
@@ -10,0 +11,3 @@
+export function pad(value: string) {
+  return value;
+}
@@ -40 +43 @@
-  return a;
+  return a + b;
`;

describe('parseUnifiedDiffAccurate', () => {
  it('records added line numbers from + hunks', () => {
    const files = parseUnifiedDiffAccurate(DIFF, '/repo');
    expect(files).toHaveLength(1);
    expect(files[0].relPath).toBe('src/utils/format.ts');
    expect(files[0].addedLines).toEqual([11, 12, 13, 43]);
  });

  it('marks new files', () => {
    const files = parseUnifiedDiffAccurate(
      `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 000..111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`,
      '/repo',
    );
    expect(files[0].status).toBe('added');
    expect(files[0].addedLines).toEqual([1, 2]);
  });
});
