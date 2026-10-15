import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["falkordb", "@redis/client", "@libsql/client"],
};

export default config;
