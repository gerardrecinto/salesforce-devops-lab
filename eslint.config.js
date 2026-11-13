const lwcConfig = require('@salesforce/eslint-config-lwc/recommended');

module.exports = [...lwcConfig, { ignores: ['**/__tests__/**'] }];
