import type { Config } from 'jest';

const transform: Config['transform'] = { '^.+\\.ts$': 'ts-jest' };

/**
 * Ba nhóm test (readme_api.md mục 11.2):
 *   unit         src/**\/*.spec.ts, không cần DB, Redis (npm test)
 *   integration  test/integration, PostgreSQL + Redis thật, Bitrix24 giả trong process
 *   e2e          test/e2e, api + worker + mock trong cùng process test
 * npm run test:cov chạy cả ba và gộp độ bao phủ (ngưỡng 80%).
 */
const config: Config = {
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/worker.ts',
    '!src/mock-server.ts',
    '!src/scripts/**',
    '!src/**/*.module.ts',
    '!src/**/*.entity.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.query.ts',
    '!src/**/*.types.ts',
    '!src/database/**',
    '!src/testing/**',
    '!src/common/constants/**',
    '!src/config/swagger.ts',
    '!src/webhooks/dto/webhook-examples.ts',
  ],
  coverageThreshold: {
    global: { lines: 80, statements: 80, functions: 80, branches: 80 },
  },
  projects: [
    {
      displayName: 'unit',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      roots: ['<rootDir>/src'],
      testRegex: '\\.spec\\.ts$',
      transform,
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/test/setup/silence-logs.ts'],
    },
    {
      displayName: 'integration',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      roots: ['<rootDir>/test/integration'],
      testRegex: '\\.int-spec\\.ts$',
      transform,
      testEnvironment: 'node',
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts', '<rootDir>/test/setup/silence-logs.ts'],
    },
    {
      displayName: 'e2e',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      roots: ['<rootDir>/test/e2e'],
      testRegex: '\\.e2e-spec\\.ts$',
      transform,
      testEnvironment: 'node',
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts', '<rootDir>/test/setup/silence-logs.ts'],
    },
  ],
};

export default config;
