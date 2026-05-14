import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanValue, numberValue, stringValue } from '../src/utils/values.js';

// --- stringValue ---

test('stringValue: string input returns same string', () => {
  assert.equal(stringValue('hello'), 'hello');
  assert.equal(stringValue(''), '');
});

test('stringValue: number input returns undefined', () => {
  assert.equal(stringValue(42), undefined);
});

test('stringValue: boolean input returns undefined', () => {
  assert.equal(stringValue(true), undefined);
});

test('stringValue: null returns undefined', () => {
  assert.equal(stringValue(null), undefined);
});

test('stringValue: undefined returns undefined', () => {
  assert.equal(stringValue(undefined), undefined);
});

test('stringValue: object returns undefined', () => {
  assert.equal(stringValue({}), undefined);
});

// --- numberValue ---

test('numberValue: finite number returns the number', () => {
  assert.equal(numberValue(42), 42);
  assert.equal(numberValue(0), 0);
  assert.equal(numberValue(-3.14), -3.14);
});

test('numberValue: NaN returns undefined', () => {
  assert.equal(numberValue(NaN), undefined);
});

test('numberValue: Infinity returns undefined', () => {
  assert.equal(numberValue(Infinity), undefined);
  assert.equal(numberValue(-Infinity), undefined);
});

test('numberValue: string input returns undefined', () => {
  assert.equal(numberValue('42'), undefined);
});

test('numberValue: boolean input returns undefined', () => {
  assert.equal(numberValue(true), undefined);
});

test('numberValue: null returns undefined', () => {
  assert.equal(numberValue(null), undefined);
});

test('numberValue: undefined returns undefined', () => {
  assert.equal(numberValue(undefined), undefined);
});

test('numberValue: object returns undefined', () => {
  assert.equal(numberValue({}), undefined);
});

// --- booleanValue ---

test('booleanValue: true returns true', () => {
  assert.equal(booleanValue(true), true);
});

test('booleanValue: false returns false', () => {
  assert.equal(booleanValue(false), false);
});

test('booleanValue: string returns undefined', () => {
  assert.equal(booleanValue('true'), undefined);
});

test('booleanValue: number returns undefined', () => {
  assert.equal(booleanValue(1), undefined);
  assert.equal(booleanValue(0), undefined);
});

test('booleanValue: null returns undefined', () => {
  assert.equal(booleanValue(null), undefined);
});

test('booleanValue: undefined returns undefined', () => {
  assert.equal(booleanValue(undefined), undefined);
});

test('booleanValue: object returns undefined', () => {
  assert.equal(booleanValue({}), undefined);
});
