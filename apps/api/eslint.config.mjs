import base from '@laporan-proyek/config/eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([globalIgnores(['src/generated/**']), base]);
