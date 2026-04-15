import '@testing-library/jest-dom/vitest';

if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock-photo';
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => undefined;
}
