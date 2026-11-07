import "./styles.css";
export const metadata = { title: "Next.js paid-access teaching example" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><main>{children}</main></body></html>;
}
