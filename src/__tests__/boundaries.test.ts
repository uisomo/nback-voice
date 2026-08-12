import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The whole "testable without a device" design rests on engine/, judge/ and
 * content/ importing nothing from React, React Native, or Expo (spec §5). That
 * held by convention only; this makes it a failing test instead of a review
 * note.
 */
const DEVICE_FREE_DIRS = ['engine', 'judge', 'content'];

const FORBIDDEN = [
  /^react$/,
  /^react\//,
  /^react-native$/,
  /^react-native\//,
  /^react-dom/,
  /^expo$/,
  /^expo-/,
  /^@expo\//,
  /^@react-native/,
  /^@react-native-async-storage/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function importedModules(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('module boundaries', () => {
  const root = join(__dirname, '..');

  it.each(DEVICE_FREE_DIRS)(
    'src/%s imports nothing from react, react-native, or expo',
    (dir) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(join(root, dir))) {
        for (const specifier of importedModules(readFileSync(file, 'utf8'))) {
          if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
            offenders.push(`${file.slice(root.length + 1)} -> ${specifier}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it('actually scans some files', () => {
    for (const dir of DEVICE_FREE_DIRS) {
      expect(sourceFiles(join(root, dir)).length).toBeGreaterThan(0);
    }
  });
});
