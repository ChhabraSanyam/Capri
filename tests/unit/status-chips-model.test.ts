import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AppEvents } from '../../src/app/events.js';
import { createEventBus } from '../../src/app/events.js';
import { describeVoice } from '../../src/domain/voice-ui-model.js';
import { CHIP_ORDER, connectionChip, StatusChipsModel } from '../../src/domain/status-chips-model.js';
import { StatusChips } from '../../src/ui/status-chips.js';

const STATES = ['connected', 'connecting', 'failed', 'not_configured'] as const;

describe('status chips model', () => {
  it('starts in Mock Mode with both integrations not configured and the voice loading', () => {
    const model = new StatusChipsModel();
    expect(model.chips.map((c) => c.id)).toEqual([...CHIP_ORDER]);
    expect(model.chips[0]).toMatchObject({ label: 'Mock Mode', tone: 'mock' });
    expect(model.chips[1]).toMatchObject({ label: 'Not configured', tone: 'off' });
    expect(model.chips[3]).toMatchObject({ label: 'Voice loading', tone: 'pending' });
  });

  it('shows Live Mode after setMode', () => {
    const model = new StatusChipsModel();
    model.setMode('live');
    expect(model.chips[0]).toMatchObject({ label: 'Live Mode', tone: 'live' });
  });

  it('maps voice status to ready, loading, and failed chips', () => {
    const model = new StatusChipsModel();
    model.setVoice(describeVoice('ready', undefined));
    expect(model.chips[3]).toMatchObject({ label: 'Voice ready', tone: 'ok' });
    model.setVoice(describeVoice('ready', 'permission-denied'));
    expect(model.chips[3]).toMatchObject({ label: 'Mic blocked', tone: 'error' });
    model.setVoice(describeVoice('loading', undefined));
    expect(model.chips[3]).toMatchObject({ label: 'Voice loading', tone: 'pending' });
  });

  it('bumps the revision only when something visible changes', () => {
    const model = new StatusChipsModel();
    const start = model.revision;
    model.setConnection('hermes', 'not_configured');
    model.setMode('mock');
    expect(model.revision).toBe(start);
    model.setConnection('hermes', 'connected');
    expect(model.revision).toBe(start + 1);
    const status = describeVoice('ready', undefined);
    model.setVoice(status);
    const afterVoice = model.revision;
    model.setVoice(status);
    expect(model.revision).toBe(afterVoice);
  });

  it('treats an unknown connection string as not configured', () => {
    const model = new StatusChipsModel();
    model.setConnection('homeAssistant', 'connected');
    model.setConnection('homeAssistant', 'banana');
    expect(model.stateOf('homeAssistant')).toBe('not_configured');
  });

  it('gives each connection state its own tone, symbol, and label (not colour alone)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATES), fc.constantFrom(...STATES), (a, b) => {
        const x = connectionChip('hermes', a);
        const y = connectionChip('hermes', b);
        if (a === b) return x.tone === y.tone && x.symbol === y.symbol && x.label === y.label;
        return x.tone !== y.tone && x.symbol !== y.symbol && x.label !== y.label;
      }),
    );
  });
});

describe('StatusChips', () => {
  it('updates the chip for the integration that changed, on emit', () => {
    const events = createEventBus<AppEvents>();
    const chips = new StatusChips(events);
    events.emit('connection:changed', { integration: 'homeAssistant', state: 'failed' });
    expect(chips.chips[1]).toMatchObject({ label: 'Failed', tone: 'error' });
    expect(chips.chips[2]).toMatchObject({ label: 'Not configured' });
    chips.dispose();
    expect(events.listenerCount('connection:changed')).toBe(0);
  });
});
