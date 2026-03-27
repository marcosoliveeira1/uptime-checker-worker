import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Arquivos para ignorar no cálculo de cobertura
      exclude: [
        'node_modules/**',
        'dist/**',
        'examples/**',
        '**/*.d.ts',
        'src/main.ts',           // Bootstrap (Entrypoint)
        'src/domain/**',         // Interfaces e Tipos (sem lógica)
        '*.js',                  // Arquivos JS na raiz
        'vitest.config.ts',
        'src/infra/config/**'    // Configuração de ENV (validação ao importar)
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});