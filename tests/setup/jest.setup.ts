/**
 * Jest setup file for integration tests
 * Registers custom matchers before tests run
 */

import { setupCustomMatchers } from '../fixtures/assertions';

// Register custom matchers globally
setupCustomMatchers();
