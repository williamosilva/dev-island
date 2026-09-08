import { describe, expect, it } from 'vitest';

import { TerminalRegistry, type ProcessProbe } from '../src/main/terminal-registry';

/** Simulated OS: only the PIDs handed in are considered alive. */
function probeWith(alive: number[]): ProcessProbe & { alive: Set<number> } {
  const set = new Set(alive);
  return { alive: set, isAlive: (pid) => set.has(pid) };
}

describe('TerminalRegistry', () => {
  it('treats a project with no recorded PID as still valid', () => {
    const registry = new TerminalRegistry(probeWith([]));
    registry.record('c:/app', null);
    expect(registry.hasLiveTerminal('c:/app')).toBe(true);
  });

  it('reports an unknown project as valid (nothing to contradict it)', () => {
    expect(new TerminalRegistry(probeWith([])).hasLiveTerminal('c:/nunca-visto')).toBe(true);
  });

  it('keeps the project valid while any of its terminals is alive', () => {
    const probe = probeWith([100, 200]);
    const registry = new TerminalRegistry(probe);
    registry.record('c:/app', 100);
    registry.record('c:/app', 200);
    expect(registry.liveTerminals('c:/app')).toEqual([100, 200]);

    probe.alive.delete(100);
    expect(registry.hasLiveTerminal('c:/app')).toBe(true);
    expect(registry.liveTerminals('c:/app')).toEqual([200]);
  });

  it('invalidates the project once every terminal is gone', () => {
    const probe = probeWith([100]);
    const registry = new TerminalRegistry(probe);
    registry.record('c:/app', 100);

    probe.alive.clear();
    expect(registry.hasLiveTerminal('c:/app')).toBe(false);

    registry.prune();
    expect(registry.liveTerminals('c:/app')).toEqual([]);
    // Pruning must not turn "all terminals died" back into "unknown".
    expect(registry.hasLiveTerminal('c:/app')).toBe(false);
  });

  it('becomes valid again when a new terminal reports the project', () => {
    const probe = probeWith([]);
    const registry = new TerminalRegistry(probe);
    registry.record('c:/app', 100);
    expect(registry.hasLiveTerminal('c:/app')).toBe(false);

    probe.alive.add(300);
    registry.record('c:/app', 300);
    expect(registry.hasLiveTerminal('c:/app')).toBe(true);
  });

  it('tracks projects independently', () => {
    const probe = probeWith([100]);
    const registry = new TerminalRegistry(probe);
    registry.record('c:/a', 100);
    registry.record('c:/b', 200);

    expect(registry.hasLiveTerminal('c:/a')).toBe(true);
    expect(registry.hasLiveTerminal('c:/b')).toBe(false);
    expect(registry.trackedProjects).toEqual(['c:/a', 'c:/b']);

    registry.forget('c:/b');
    expect(registry.trackedProjects).toEqual(['c:/a']);
  });
});
