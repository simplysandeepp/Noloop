import Image from "next/image";
import Link from "next/link";
import { cn } from "../../lib/utils";

interface LogoProps {
  /** pixel size of the mark square */
  size?: number;
  /** show "NoLoop" wordmark next to the mark */
  showWordmark?: boolean;
  /** light variant — wordmark in white (for dark backgrounds) */
  light?: boolean;
  /** where clicking the logo navigates (default: home) */
  href?: string;
  className?: string;
}

/** NoLoop infinity-loop mark + wordmark (navy → teal gradient). Clicks → home. */
export default function Logo({
  size = 32,
  showWordmark = true,
  light = false,
  href = "/",
  className,
}: LogoProps) {
  return (
    <Link
      href={href}
      aria-label="NoLoop — go to home"
      className={cn(
        "flex items-center gap-2 shrink-0 transition-opacity hover:opacity-80",
        className,
      )}
    >
      <div
        className="rounded-lg bg-white flex items-center justify-center p-1 shadow-sm border border-sky-100"
        style={{ width: size, height: size }}
      >
        <Image
          src="/noloop-mark.svg"
          alt="NoLoop"
          width={size - 10}
          height={Math.round((size - 10) * 0.625)} // viewBox 64×40 → 0.625
          priority
        />
      </div>
      {showWordmark && (
        <span
          className={cn(
            "font-black tracking-tight leading-none select-none",
            light ? "text-white" : "text-[#18365B]",
          )}
          style={{ fontSize: size * 0.5 }}
        >
          NoLoop
        </span>
      )}
    </Link>
  );
}
