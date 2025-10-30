/**
 * TypeScript declarations for custom Jest matchers
 * This file extends Jest's Matchers interface with our custom matchers
 *
 * This file must be referenced in test files using a triple-slash directive:
 * /// <reference path="./jest-custom-matchers.d.ts" />
 */

declare module 'expect' {
  interface Matchers<R extends void | Promise<void>, T = unknown> {
    toAllowDomain(domain: string): R;
    toBlockDomain(domain: string): R;
    toExitWithCode(code: number): R;
    toSucceed(): R;
    toFail(): R;
    toTimeout(): R;
  }
}
