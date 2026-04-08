import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { LogOut, User } from "lucide-react";

export function DashboardHeader() {
  const { user, logout } = useAuth();
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    } finally {
      logout();
    }
  };

  return (
    <header className="border-b bg-white">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-2xl font-bold">Fraga Dashboard</h1>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-gray-600" />
            <div>
              <p className="text-sm font-medium">{user?.name || user?.email}</p>
              <p className="text-xs text-gray-500">{user?.role}</p>
            </div>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
