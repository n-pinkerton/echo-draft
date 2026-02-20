import logoIcon from "../../assets/icon.png";
import { Button } from "../ui/button";
import { ArrowRight, Check } from "lucide-react";

export function SignedInView({
  userName,
  onContinue,
}: {
  userName?: string | null;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-center mb-4">
        <img
          src={logoIcon}
          alt="EchoDraft"
          className="w-12 h-12 mx-auto mb-2.5 rounded-lg shadow-sm"
        />
        <div className="w-5 h-5 mx-auto bg-success/10 rounded-full flex items-center justify-center mb-2">
          <Check className="w-3 h-3 text-success" />
        </div>
        <p className="text-lg font-semibold text-foreground tracking-tight leading-tight">
          Welcome back{userName ? `, ${userName}` : ""}
        </p>
        <p className="text-muted-foreground text-sm mt-1 leading-tight">
          You're signed in and ready to go.
        </p>
      </div>
      <Button onClick={onContinue} className="w-full h-9">
        <span className="text-sm font-medium">Continue</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

