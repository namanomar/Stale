import { ConnectorDetail } from "@/components/pages/Integrations";

export const metadata = { title: "Connector · Stale" };

export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return <ConnectorDetail type={type} />;
}
