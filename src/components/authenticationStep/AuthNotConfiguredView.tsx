import logoIcon from "../../assets/icon.png";
import { Button } from "../ui/button";
import { ArrowRight } from "lucide-react";

export function AuthNotConfiguredView({
  onContinueWithoutAccount,
}: {
  onContinueWithoutAccount: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-center mb-4">
        <img
          src={logoIcon}
          alt="EchoDraft"
          className="w-12 h-12 mx-auto mb-2.5 rounded-lg shadow-sm"
        />
        <p className="text-lg font-semibold text-foreground tracking-tight leading-tight">
          Welcome to EchoDraft
        </p>
        <p className="text-muted-foreground text-sm mt-1 leading-tight">
          Dictate anywhere using your voice
        </p>
      </div>

      <div className="bg-warning/5 p-2.5 rounded border border-warning/20">
        <p className="text-[10px] text-warning text-center leading-snug">
          Cloud features not configured. You can still use EchoDraft locally.
        </p>
      </div>

      <Button onClick={onContinueWithoutAccount} className="w-full h-9">
        <span className="text-sm font-medium">Get Started</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

