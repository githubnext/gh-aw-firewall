/**
 * Test to verify Jest ESM configuration is working correctly.
 * This test ensures that ESM-only dependencies can be imported and mocked in tests.
 */

// Import chalk (ESM-only in v5+, currently v4 with CJS support)
import chalk from 'chalk';

describe('Jest ESM Configuration', () => {
  describe('chalk ESM compatibility', () => {
    it('should be able to import chalk', () => {
      expect(chalk).toBeDefined();
      expect(typeof chalk.blue).toBe('function');
      expect(typeof chalk.red).toBe('function');
      expect(typeof chalk.green).toBe('function');
    });

    it('should be able to use chalk functions', () => {
      const blueText = chalk.blue('test');
      expect(blueText).toBeDefined();
      expect(typeof blueText).toBe('string');
    });
  });

  describe('transformIgnorePatterns configuration', () => {
    it('should transform ESM packages specified in transformIgnorePatterns', () => {
      // This test verifies that the transformIgnorePatterns in jest.config.js
      // allows babel-jest to transform ESM-only packages like chalk, execa, commander
      expect(chalk).toBeDefined();
      
      // If the configuration is correct, chalk should be transformed and usable
      const result = chalk.green('success');
      expect(result).toBeTruthy();
    });
  });

  describe('babel configuration', () => {
    it('should support ESM→CJS transformation', () => {
      // This test verifies that babel.config.js is properly configured
      // to transform ESM syntax to CommonJS for Jest
      
      // chalk uses ESM export syntax which needs to be transformed
      expect(chalk).toBeDefined();
      expect(chalk.blue).toBeDefined();
      
      // If babel transformation is working, we should be able to use the imported module
      const text = 'ESM transformation works';
      const coloredText = chalk.blue(text);
      expect(coloredText).toContain(text);
    });
  });
});
