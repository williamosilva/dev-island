import { describe, expect, it } from 'vitest';

import { planInit } from '../src/cli/init-plan';

const OUTSIDE_MESSAGE =
  'the widget appears once the project is detected in a VS Code integrated terminal';

describe('planInit', () => {
  it('init in an external terminal starts hidden and activates nothing', () => {
    const plan = planInit({ insideVsCode: false, preview: false, noStart: false });

    expect(plan.activateProject).toBe(false);
    expect(plan.preview).toBe(false);
    expect(plan.launchArgs).toEqual([]);
    expect(plan.messages).toEqual([
      'project initialized',
      'widget started in the background',
      OUTSIDE_MESSAGE,
    ]);
  });

  it('--skip-shell-integration alone never forces the widget on screen', () => {
    // --skip-shell-integration is not part of the plan at all: only --preview
    // and the VS Code environment can activate a project.
    expect(planInit({ insideVsCode: false, preview: false, noStart: false })).toMatchObject({
      activateProject: false,
      preview: false,
    });
  });

  it('init inside the VS Code integrated terminal activates the project', () => {
    const plan = planInit({ insideVsCode: true, preview: false, noStart: false });

    expect(plan.activateProject).toBe(true);
    expect(plan.preview).toBe(false);
    expect(plan.launchArgs).toEqual([]);
    expect(plan.messages).toEqual([
      'project initialized',
      'widget started in the background',
      'project activated from the VS Code integrated terminal',
    ]);
  });

  it('--preview activates the project and turns preview mode on', () => {
    const plan = planInit({ insideVsCode: false, preview: true, noStart: false });

    expect(plan.activateProject).toBe(true);
    expect(plan.preview).toBe(true);
    expect(plan.launchArgs).toEqual(['--preview']);
    expect(plan.messages[2]).toBe('modo --preview: o widget aparece mesmo fora do VS Code');
  });

  it('--preview inside VS Code stays in preview mode', () => {
    expect(planInit({ insideVsCode: true, preview: true, noStart: false })).toMatchObject({
      activateProject: true,
      preview: true,
      launchArgs: ['--preview'],
    });
  });

  it('--no-start reports that nothing was launched', () => {
    const plan = planInit({ insideVsCode: false, preview: false, noStart: true });
    expect(plan.messages).toEqual(['project initialized', 'widget not started (--no-start)']);
  });
});
