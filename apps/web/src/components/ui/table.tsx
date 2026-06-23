import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui互換のtable containerである。
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} ref={ref} {...props} />
    </div>
  )
);
Table.displayName = "Table";

/**
 * table headerである。
 */
const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead className={cn("[&_tr]:border-b", className)} ref={ref} {...props} />
);
TableHeader.displayName = "TableHeader";

/**
 * table bodyである。
 */
const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} ref={ref} {...props} />
  )
);
TableBody.displayName = "TableBody";

/**
 * table rowである。
 */
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)}
      ref={ref}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

/**
 * table heading cellである。
 */
const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      className={cn("h-10 px-3 text-left align-middle font-medium text-muted-foreground", className)}
      ref={ref}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

/**
 * table data cellである。
 */
const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td className={cn("p-3 align-middle", className)} ref={ref} {...props} />
);
TableCell.displayName = "TableCell";

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
