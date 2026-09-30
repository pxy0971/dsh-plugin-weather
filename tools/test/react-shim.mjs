/**
 * Minimal React stand-in for the bundle test bench.
 *
 * The panel only needs the element shape, the six hooks it actually calls, and a
 * class-component base. Rather than pull a full React into this repository, the
 * bench supplies this module and inspects the returned element tree as plain
 * objects — which is enough to prove the bundle loads, the component body runs, and
 * the rendered tree carries the expected text.
 *
 * It is deliberately small and permissive: unknown props pass through, so a test
 * can assert on any attribute the component sets.
 */

/** Marker property identifying a rendered element. */
export const ELEMENT_TYPE = Symbol.for('dsh-weather-test.element')

/**
 * Create an element node.
 * @param type - tag name, function component, or class component.
 * @param props - element props.
 * @param children - variadic children.
 * @returns an element node.
 */
export function createElement(type, props, ...children) {
  const merged = props === null || props === undefined ? {} : { ...props }
  if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
  return { [ELEMENT_TYPE]: true, type, props: merged }
}

/**
 * Classic `react/jsx-runtime` `jsx` signature, which is what the bundle is built
 * against.
 *
 * The generated bundle calls `jsx(type, config, maybeKey)` and `jsxs(type, config,
 * maybeKey)` — the classic runtime, where children travel *inside* `config`. That
 * differs from the automatic runtime's `jsx(type, props, key)`, so the bench has to
 * supply this signature rather than aliasing {@link createElement}; doing the
 * latter silently drops every children array into the `key` slot.
 *
 * @param type - tag name or component.
 * @param config - props, including `children`.
 * @param maybeKey - React key, ignored by the bench.
 * @returns an element node.
 */
export function jsx(type, config, maybeKey) {
  const merged = config === null || config === undefined ? {} : { ...config }
  if (maybeKey !== undefined) merged.key = maybeKey
  return { [ELEMENT_TYPE]: true, type, props: merged }
}

/** `jsxs` is the same signature with static children; identical here. */
export const jsxs = jsx

/**
 * Return children unchanged.
 *
 * React's own `Fragment` renders its children and contributes no element of its
 * own; returning `null` for an empty fragment mirrors that instead of leaking
 * `undefined` into the tree walk.
 *
 * @param props - component props.
 * @returns the children value, or `null`.
 */
export function Fragment(props) {
  return props.children === undefined ? null : props.children
}

/** Hook state, replaced per render by the bench's renderer. */
const hooks = { cells: [], cursor: 0, effects: [] }

/**
 * Reset the hook cells before one render pass.
 * @param cells - persistent hook storage for the component instance.
 */
export function __resetHooks(cells) {
  hooks.cells = cells
  hooks.cursor = 0
  hooks.effects = []
}

/**
 * Collect the effects scheduled during the current render pass.
 * @returns the queued effect entries.
 */
export function __takeEffects() {
  const taken = hooks.effects
  hooks.effects = []
  return taken
}

/**
 * Advance to the next hook cell, creating it when the render is the first.
 * @param factory - initial value factory.
 * @returns the mutable cell.
 */
function cell(factory) {
  const index = hooks.cursor++
  if (hooks.cells.length <= index) hooks.cells.push({ value: factory() })
  return hooks.cells[index]
}

/**
 * `useState` with the same tuple shape React returns.
 * @param initial - initial value or lazy initializer.
 * @returns `[value, setValue]`.
 */
export function useState(initial) {
  const slot = cell(() => (typeof initial === 'function' ? initial() : initial))
  if (slot.setter === undefined) {
    slot.setter = next => {
      slot.value = typeof next === 'function' ? next(slot.value) : next
    }
  }
  return [slot.value, slot.setter]
}

/**
 * `useRef` returning a stable mutable box.
 * @param initial - initial `current` value.
 * @returns the ref object.
 */
export function useRef(initial) {
  return cell(() => ({ current: initial })).value
}

/**
 * `useMemo` that recomputes when any dependency changes.
 * @param factory - memoized factory.
 * @param deps - dependency list.
 * @returns the memoized value.
 */
export function useMemo(factory, deps) {
  const slot = cell(() => ({ deps: undefined, value: undefined }))
  const changed = slot.deps === undefined || deps === undefined || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps[index]))
  if (changed) {
    slot.value = factory()
    slot.deps = deps
  }
  return slot.value
}

/**
 * `useCallback` built on the same dependency rule as `useMemo`.
 * @param factory - the callback.
 * @param deps - dependency list.
 * @returns the memoized callback.
 */
export function useCallback(factory, deps) {
  return useMemo(() => factory, deps)
}

/**
 * `useEffect` that records the effect for the bench to run explicitly.
 *
 * The bench never re-renders automatically, so effects are collected and executed
 * by the test in a controlled order instead of after a commit.
 *
 * @param effect - the effect body.
 * @param deps - dependency list.
 */
export function useEffect(effect, deps) {
  const slot = cell(() => ({ deps: undefined, cleanup: undefined }))
  const changed = slot.deps === undefined || deps === undefined || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps[index]))
  if (!changed) return
  slot.deps = deps
  if (typeof slot.cleanup === 'function') slot.cleanup()
  hooks.effects.push({ slot, effect })
}

/**
 * Minimal class-component base with `setState` and `forceUpdate`.
 */
export class Component {
  /**
   * @param props - component props.
   */
  constructor(props) {
    this.props = props
    this.state = {}
  }

  /**
   * Merge partial state.
   * @param partial - state patch or updater.
   */
  setState(partial) {
    const patch = typeof partial === 'function' ? partial(this.state) : partial
    this.state = { ...this.state, ...patch }
  }
}

/** Default export mirroring React's namespace object. */
export default { createElement, Fragment, Component, useState, useEffect, useMemo, useRef, useCallback }
