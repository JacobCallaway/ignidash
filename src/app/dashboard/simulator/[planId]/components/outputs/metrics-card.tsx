import { InfoIcon } from 'lucide-react';
import Card from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface MetricsCardProps {
  name: string;
  stat: string | number;
  statContext?: string;
  statWidget?: React.ReactNode;
  infoTooltip?: string;
  className?: string;
  statClassName?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

export default function MetricsCard({
  name,
  stat,
  statContext,
  statWidget,
  infoTooltip,
  className,
  statClassName,
  onClick,
  ariaLabel,
}: MetricsCardProps) {
  const title = (
    <div className="flex items-center justify-center gap-2 sm:justify-start">
      <span className="text-muted-foreground block truncate text-sm font-medium">{name}</span>
      {infoTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground transition hover:border-foreground hover:text-foreground">
              <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6} className="max-w-xs text-left">
            {infoTooltip}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );

  const card = (
    <Card className={cn('my-0 text-center sm:text-left', className, onClick && 'cursor-pointer')}>
      <div className="sm:flex sm:items-center sm:justify-between">
        <div className="flex-1">
          {title}
          <div className="text-foreground mt-1 text-3xl font-semibold tracking-tight">
            <span className={statClassName}>{stat}</span>
            <span className="text-muted-foreground ml-1 text-sm">{statContext}</span>
          </div>
        </div>
        <div className="hidden sm:block" aria-hidden="true">
          {statWidget}
        </div>
      </div>
    </Card>
  );

  if (!onClick) return card;

  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel ?? name} className="w-full text-left">
      {card}
    </button>
  );
}
