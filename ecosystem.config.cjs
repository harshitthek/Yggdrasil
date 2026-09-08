module.exports = {
  apps: [
    {
      name: 'world-tree',
      script: './src/index.js',
      cwd: '/home/opc/apps/Yggdrasil-Bot',

      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      watch: false,

      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,

      node_args: '--max-old-space-size=384 --optimize-for-size',
      max_memory_restart: '500M',

      kill_timeout: 10000,
      listen_timeout: 10000,
      wait_ready: false,

      time: true,
      merge_logs: true,

      out_file: './logs/world-tree.out.log',
      error_file: './logs/world-tree.err.log',

      env: {
        NODE_ENV: 'development'
      },

      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
