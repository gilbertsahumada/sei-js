import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sei MCP Client",
  description: "Web client for Sei MCP server interactions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
