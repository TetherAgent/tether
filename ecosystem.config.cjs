module.exports = {
  apps: [
    {
      name: 'tether-relay',
      script: './apps/relay/dist/main.js',
      cwd: '/data/tether',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
