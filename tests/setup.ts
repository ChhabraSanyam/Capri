import fc from 'fast-check';

// Every property test runs at least 100 iterations (design: Testing Strategy).
fc.configureGlobal({ numRuns: 100 });
