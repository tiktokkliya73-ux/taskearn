import { AppProviders, AuthProvider } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <AppProviders>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </AppProviders>
  );
}
