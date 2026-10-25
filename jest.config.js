module.exports = {
  verbose: true,
  testEnvironment: 'jest-environment-jsdom',
  preset: 'ts-jest',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@t/(.*)$': '<rootDir>/src/types/$1',
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
};
