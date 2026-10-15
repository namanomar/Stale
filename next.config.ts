import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["falkordb", "@redis/client"],
};

export default config;
