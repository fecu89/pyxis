module.exports = {
  apps: [
    {
      name: "pdev",
      cwd: "/home/fecu/web/pyxis",
      script: "server.ts",
      interpreter: "node",
      node_args: "--max-old-space-size=3072 --import tsx",
      env: {
        NODE_ENV: "development",
        PORT: "3001",
        // PM2 서비스의 4GB cgroup 안에서 Next와 변환 컨테이너 두 개가 동시에 경쟁하지 않게 합니다.
        DOCUMENT_CONVERT_CONCURRENCY: "1",
      },
      // PM2가 yarn/tsx watch 부모가 아니라 실제 Next 프로세스를 감시해야 OOM 시 재시작할 수 있습니다.
      max_memory_restart: "2600M",
      kill_timeout: 10_000,
      restart_delay: 1_000,
    },
  ],
};
