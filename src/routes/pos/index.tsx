import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useAction } from "convex/react";
import { useState, useMemo, useEffect } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  User,
  Receipt,
  Loader2,
  Package,
  PlusCircle,
  X,
  Printer,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Badge } from "#/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Label } from "#/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import POSLayout from "#/layouts/pos/pos-layout";
import { CustomerInput } from "#/components/pos/customer-selector";

export const Route = createFileRoute("/pos/")({
  component: RouteComponent,
});

type SizePricing = {
  size: string;
  costPrice: number;
  sellingPrice: number;
};

type Product = {
  _id: string;
  name: string;
  sku: string;
  sellingPrice: number;
  sizes?: string[];
  colors?: string[];
  variants?: string[];
  sizePricing?: SizePricing[];
  isActive: boolean;
  departmentId: string;
};

type InventoryItem = {
  inventoryId: string;
  productId: string;
  product: Product | null;
  quantity: number;
  reorderLevel?: number;
};

type CartLine = {
  productId: string;
  name: string;
  sku: string;
  size?: string;
  color?: string;
  variant?: string;
  unitPrice: number;
  quantity: number;
  availableQuantity: number;
  departmentId: string;
  departmentName: string;
  manualDiscount?: number;
};

type PaymentMethod =
  | "Cash"
  | "Card"
  | "Mpesa"
  | "Ecocash"
  | "Bank Transfer"
  | "Mobile Payment"
  | "Credit"
  | "Voucher";

type PaymentSplit = {
  method: PaymentMethod;
  amount: number;
  amountReceived?: number;
  changeDue?: number;
};

type SaleDiscount = {
  productId: string;
  discountAmount: number;
  reason?: string;
};

type CompletedSale = {
  saleId: string;
  storeName: string;
  storePhone: string | null;
  storeAddress: string | null;
  customerName: string | null;
  cashierName: string | null;
  paymentMethod: string;
  payments: PaymentSplit[];
  items: CartLine[];
  discounts: SaleDiscount[];
  total: number;
  itemCount: number;
  completedAt: number;
  amountReceived?: number;
  changeDue?: number;
};

function cartKey(
  productId: string,
  size?: string,
  color?: string,
  variant?: string
) {
  return `${productId}::${size ?? ""}::${color ?? ""}::${variant ?? ""}`;
}

function resolvePrice(product: Product, size?: string) {
  if (size && product.sizePricing?.length) {
    const match = product.sizePricing.find((sp) => sp.size === size);
    if (match) return match.sellingPrice;
  }
  return product.sellingPrice;
}

function needsVariantPicker(product: Product) {
  return (
    (product.sizes && product.sizes.length > 0) ||
    (product.colors && product.colors.length > 0) ||
    (product.variants && product.variants.length > 0)
  );
}

function formatCurrency(amount: number) {
  return `R${amount.toFixed(2)}`;
}

function computeFrontendDiscounts(cart: CartLine[]): number {
  const TYRE_DISCOUNT_THRESHOLD = 4;
  const TYRE_DISCOUNT_AMOUNT = 200;

  function extractRimSize(sizeStr: string): number | null {
    const m =
      sizeStr.match(/[Rr](\d+)$/) ||
      sizeStr.match(/^(\d+)$/) ||
      sizeStr.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }

  const productQty: Record<string, number> = {};
  for (const line of cart) {
    if (!line.departmentName.toLowerCase().includes("tyre")) continue;
    if (!line.size) continue;
    const rim = extractRimSize(line.size);
    if (rim === null || rim < 14) continue;
    productQty[line.productId] = (productQty[line.productId] || 0) + line.quantity;
  }

  let autoDiscountTotal = 0;
  for (const qty of Object.values(productQty)) {
    if (qty >= TYRE_DISCOUNT_THRESHOLD)
      autoDiscountTotal += TYRE_DISCOUNT_AMOUNT;
  }

  const manualDiscountTotal = cart.reduce(
    (sum, l) => sum + (l.manualDiscount || 0),
    0
  );
  return autoDiscountTotal + manualDiscountTotal;
}

function RouteComponent() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(
    null
  );
  const [receiptPrinted, setReceiptPrinted] = useState(false);

  const [payments, setPayments] = useState<PaymentSplit[]>([
    { method: "Cash", amount: 0, amountReceived: 0, changeDue: 0 },
  ]);
  const [isSplitPayment, setIsSplitPayment] = useState(false);

  const [pickerItem, setPickerItem] = useState<InventoryItem | null>(null);
  const [pickerSize, setPickerSize] = useState<string | null>(null);
  const [pickerColor, setPickerColor] = useState<string | null>(null);
  const [pickerVariant, setPickerVariant] = useState<string | null>(null);

  const myStore = useQuery(api.stores.getMyStore);
  const activeStoresList = useQuery(
    api.stores.getActiveStores,
    myStore === null ? {} : "skip"
  );
  const departments = useQuery(api.departments.getAllDepartments);
  const currentUser = useQuery(api.users.getCurrentUser);
  const inventory = useQuery(
    api.inventory.getInventoryByStore,
    storeId ? { storeId: storeId as any } : "skip"
  ) as InventoryItem[] | undefined;
  
  const storePrintSettings = useQuery(
    api.stores.getStorePrintSettings,
    storeId ? { storeId: storeId as any } : "skip"
  );

  const createSale = useMutation(api.sales.createSale);
  const findOrCreateCustomer = useMutation(api.customers.findOrCreateByName);
  const recordPurchase = useMutation(api.customers.recordPurchase);
  const printReceipt = useAction(api.print.printReceipt);

  const activeStores = useMemo(
    () => activeStoresList?.filter((s) => s.isActive) ?? [],
    [activeStoresList]
  );

  useEffect(() => {
    if (myStore) setStoreId(myStore._id);
  }, [myStore]);

  const filteredProducts = useMemo(() => {
    if (!inventory) return [];
    return inventory.filter((item) => {
      if (item.quantity <= 0) return false;
      if (!item.product) return false;
      if (departmentId && item.product.departmentId !== departmentId)
        return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = item.product.name.toLowerCase().includes(q);
        const matchesSku = item.product.sku.toLowerCase().includes(q);
        if (!matchesName && !matchesSku) return false;
      }
      return true;
    });
  }, [inventory, departmentId, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart]
  );

  const discountTotal = useMemo(() => computeFrontendDiscounts(cart), [cart]);

  const netTotal = useMemo(
    () => Math.max(0, cartTotal - discountTotal),
    [cartTotal, discountTotal]
  );

  const cartItemCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart]
  );

  const cartQuantityForProduct = (productId: string) =>
    cart
      .filter((line) => line.productId === productId)
      .reduce((sum, line) => sum + line.quantity, 0);

  const totalPaymentAmount = useMemo(() => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  const totalAmountReceived = useMemo(() => {
    return payments.reduce((sum, p) => sum + (p.amountReceived || p.amount), 0);
  }, [payments]);

  const totalChangeDue = useMemo(() => {
    return payments.reduce((sum, p) => sum + (p.changeDue || 0), 0);
  }, [payments]);

  const addPaymentSplit = () => {
    const usedMethods = payments.map((p) => p.method);
    const availableMethods = [
      "Cash",
      "Card",
      "Mpesa",
      "Ecocash",
      "Bank Transfer",
      "Mobile Payment",
      "Credit",
      "Voucher",
    ].filter((m) => !usedMethods.includes(m as PaymentMethod));

    if (availableMethods.length === 0) {
      toast.error("All payment methods are already added");
      return;
    }

    setPayments([
      ...payments,
      {
        method: availableMethods[0] as PaymentMethod,
        amount: 0,
        ...(availableMethods[0] === "Cash"
          ? { amountReceived: 0, changeDue: 0 }
          : {}),
      },
    ]);
  };

  const removePaymentSplit = (index: number) => {
    if (payments.length <= 1) {
      toast.error("At least one payment method is required");
      return;
    }
    setPayments(payments.filter((_, i) => i !== index));
  };

  const updatePaymentSplit = (
    index: number,
    field: keyof PaymentSplit,
    value: any
  ) => {
    const updated = [...payments];
    updated[index] = { ...updated[index], [field]: value };

    if (field === "amountReceived" && updated[index].method === "Cash") {
      const amount = updated[index].amount || 0;
      const received = value || 0;
      updated[index].changeDue = Math.max(0, received - amount);
    }
    if (field === "amount" && updated[index].method === "Cash") {
      const amount = value || 0;
      const received = updated[index].amountReceived || 0;
      updated[index].changeDue = Math.max(0, received - amount);
    }

    setPayments(updated);
  };

  const resetPayments = () => {
    setPayments([
      { method: "Cash", amount: 0, amountReceived: 0, changeDue: 0 },
    ]);
    setIsSplitPayment(false);
  };

  const addToCart = (
    item: InventoryItem,
    unitPrice: number,
    selection: { size?: string; color?: string; variant?: string }
  ) => {
    if (!item.product) return;
    const product = item.product;
    const key = cartKey(
      item.productId,
      selection.size,
      selection.color,
      selection.variant
    );
    const alreadyInCart = cartQuantityForProduct(item.productId);

    if (alreadyInCart >= item.quantity) {
      toast.error(`Only ${item.quantity} of "${product.name}" available`);
      return;
    }

    const department = departments?.find((d) => d._id === product.departmentId);
    const departmentName = department?.name || "General";

    setCart((prev) => {
      const existing = prev.find(
        (line) =>
          cartKey(line.productId, line.size, line.color, line.variant) === key
      );
      if (existing) {
        return prev.map((line) =>
          cartKey(line.productId, line.size, line.color, line.variant) === key
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      return [
        ...prev,
        {
          productId: item.productId,
          name: product.name,
          sku: product.sku,
          size: selection.size,
          color: selection.color,
          variant: selection.variant,
          unitPrice,
          quantity: 1,
          availableQuantity: item.quantity,
          departmentId: product.departmentId,
          departmentName,
          manualDiscount: 0,
        },
      ];
    });
  };

  const handleProductClick = (item: InventoryItem) => {
    if (!item.product) return;
    const alreadyInCart = cartQuantityForProduct(item.productId);
    if (alreadyInCart >= item.quantity) {
      toast.error(`Only ${item.quantity} of "${item.product.name}" available`);
      return;
    }
    if (needsVariantPicker(item.product)) {
      setPickerItem(item);
      setPickerSize(item.product.sizes?.[0] ?? null);
      setPickerColor(item.product.colors?.[0] ?? null);
      setPickerVariant(item.product.variants?.[0] ?? null);
    } else {
      addToCart(item, item.product.sellingPrice, {});
    }
  };

  const closePicker = () => {
    setPickerItem(null);
    setPickerSize(null);
    setPickerColor(null);
    setPickerVariant(null);
  };

  const confirmPickerSelection = () => {
    if (!pickerItem?.product) return;
    const product = pickerItem.product;
    if (product.sizes?.length && !pickerSize) {
      toast.error("Select a size");
      return;
    }
    if (product.colors?.length && !pickerColor) {
      toast.error("Select a color");
      return;
    }
    if (product.variants?.length && !pickerVariant) {
      toast.error("Select a variant");
      return;
    }
    const unitPrice = resolvePrice(product, pickerSize ?? undefined);
    addToCart(pickerItem, unitPrice, {
      size: pickerSize ?? undefined,
      color: pickerColor ?? undefined,
      variant: pickerVariant ?? undefined,
    });
    closePicker();
  };

  const updateCartQuantity = (key: string, quantity: number) => {
    setCart((prev) =>
      prev.map((line) => {
        if (cartKey(line.productId, line.size, line.color, line.variant) !== key)
          return line;
        const otherLinesQty = prev
          .filter(
            (l) =>
              l.productId === line.productId &&
              cartKey(l.productId, l.size, l.color, l.variant) !== key
          )
          .reduce((sum, l) => sum + l.quantity, 0);
        const maxForThisLine = line.availableQuantity - otherLinesQty;
        if (quantity > maxForThisLine) {
          toast.error(`Only ${maxForThisLine} of "${line.name}" available`);
          return { ...line, quantity: Math.max(1, maxForThisLine) };
        }
        return { ...line, quantity: Math.max(1, quantity) };
      })
    );
  };

  const updateCartPrice = (key: string, unitPrice: number) => {
    setCart((prev) =>
      prev.map((line) =>
        cartKey(line.productId, line.size, line.color, line.variant) === key
          ? { ...line, unitPrice: Math.max(0, unitPrice) }
          : line
      )
    );
  };

  const updateCartDiscount = (key: string, discount: number) => {
    setCart((prev) =>
      prev.map((line) =>
        cartKey(line.productId, line.size, line.color, line.variant) === key
          ? { ...line, manualDiscount: Math.max(0, discount) }
          : line
      )
    );
  };

  const removeFromCart = (key: string) => {
    setCart((prev) =>
      prev.filter(
        (line) =>
          cartKey(line.productId, line.size, line.color, line.variant) !== key
      )
    );
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName("");
    resetPayments();
  };

  const handleCheckout = async () => {
    if (!storeId) {
      toast.error("Select a store first");
      return;
    }
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    const totalPayment = payments.reduce((sum, p) => sum + p.amount, 0);
    if (Math.abs(totalPayment - netTotal) > 0.01) {
      toast.error(
        `Payment total (${formatCurrency(
          totalPayment
        )}) does not match sale total (${formatCurrency(netTotal)})`
      );
      return;
    }

    for (const payment of payments) {
      if (payment.method === "Cash") {
        if (!payment.amountReceived || payment.amountReceived < payment.amount) {
          toast.error(
            `Cash payment of ${formatCurrency(
              payment.amount
            )} requires amount received >= ${formatCurrency(payment.amount)}`
          );
          return;
        }
      }
      if (payment.amount <= 0) {
        toast.error("Each payment amount must be greater than zero");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let resolvedCustomerId: string | undefined;
      let resolvedCustomerName: string | null = null;

      if (customerName.trim()) {
        resolvedCustomerId = await findOrCreateCustomer({
          name: customerName.trim(),
        });
        resolvedCustomerName = customerName.trim();
      }

      const saleId = await createSale({
        storeId: storeId as any,
        customerId: resolvedCustomerId ? (resolvedCustomerId as any) : undefined,
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          amountReceived: p.method === "Cash" ? p.amountReceived : undefined,
          changeDue: p.method === "Cash" ? p.changeDue : undefined,
        })),
        items: cart.map((line) => ({
          productId: line.productId as any,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          size: line.size,
          color: line.color,
          variant: line.variant,
          departmentName: line.departmentName,
          manualDiscount: line.manualDiscount || 0,
        })),
      });

      if (resolvedCustomerId) {
        await recordPurchase({
          customerId: resolvedCustomerId as any,
          amount: netTotal,
        });
      }

      const receiptDiscounts: SaleDiscount[] = [];
      try {
        const TYRE_DISCOUNT_THRESHOLD = 4;
        const TYRE_DISCOUNT_AMOUNT = 200;

        function extractRimSize(sizeStr: string): number | null {
          const rimMatch =
            sizeStr.match(/[Rr](\d+)$/) ||
            sizeStr.match(/^(\d+)$/) ||
            sizeStr.match(/(\d+)$/);
          if (!rimMatch) return null;
          return parseInt(rimMatch[1], 10);
        }

        const productQty: Record<string, { qty: number; departmentName: string }> =
          {};
        for (const line of cart) {
          if (!line.departmentName.toLowerCase().includes("tyre")) continue;
          if (!line.size) continue;
          const rim = extractRimSize(line.size);
          if (rim === null || rim < 14) continue;
          if (!productQty[line.productId]) {
            productQty[line.productId] = {
              qty: 0,
              departmentName: line.departmentName,
            };
          }
          productQty[line.productId].qty += line.quantity;
        }

        for (const [productId, { qty }] of Object.entries(productQty)) {
          if (qty >= TYRE_DISCOUNT_THRESHOLD) {
            receiptDiscounts.push({
              productId,
              discountAmount: TYRE_DISCOUNT_AMOUNT,
              reason: `Tyre bulk discount (${qty}x, size 14+)`,
            });
          }
        }

        for (const line of cart) {
          if (line.manualDiscount && line.manualDiscount > 0) {
            receiptDiscounts.push({
              productId: line.productId,
              discountAmount: line.manualDiscount,
              reason: "Manual discount",
            });
          }
        }
      } catch {
        // receiptDiscounts stays empty — non-fatal
      }

      const cashierName = currentUser?.name || currentUser?.email || "Unknown";
      const currentStore = myStore ?? activeStores.find((s) => s._id === storeId);

      const paymentLabel =
        payments.length === 1
          ? payments[0].method
          : payments.map((p) => p.method).join(" + ");

      setCompletedSale({
        saleId: saleId.toString(),
        storeName: currentStore?.name ?? "Store",
        storePhone: currentStore?.phone ?? null,
        storeAddress: currentStore?.address ?? null,
        customerName: resolvedCustomerName,
        cashierName,
        paymentMethod: paymentLabel,
        payments: payments,
        items: cart,
        discounts: receiptDiscounts,
        total: netTotal,
        itemCount: cartItemCount,
        completedAt: Date.now(),
        amountReceived: totalAmountReceived,
        changeDue: totalChangeDue,
      });

      setReceiptPrinted(false);
      toast.success(
        `Sale completed — ${cartItemCount} item(s), ${formatCurrency(netTotal)}`
      );
      clearCart();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete sale");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = async () => {
    if (!completedSale) return;
    
    // Get the agent ID from store settings
    const agentId = storePrintSettings?.printAgentId;
    
    if (!agentId) {
      toast.error(
        "No printer configured for this store. Please set up a printer in store settings.",
        {
          action: {
            label: "Go to Settings",
            onClick: () => {
              // Navigate to store settings
              window.location.href = "/admin/store-settings";
            },
          },
        }
      );
      return;
    }
    
    try {
      const receiptItems = completedSale.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        size: item.size,
        color: item.color,
        variant: item.variant,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        availableQuantity: item.availableQuantity,
        departmentId: item.departmentId,
        departmentName: item.departmentName,
      }));

      const result = await printReceipt({
        saleId: completedSale.saleId,
        storeName: completedSale.storeName,
        storePhone: completedSale.storePhone || undefined,
        storeAddress: completedSale.storeAddress || undefined,
        customerName: completedSale.customerName || undefined,
        cashierName: completedSale.cashierName || undefined,
        paymentMethod: completedSale.paymentMethod,
        amountReceived: completedSale.amountReceived,
        changeDue: completedSale.changeDue,
        items: receiptItems,
        discounts: completedSale.discounts,
        total: completedSale.total,
        itemCount: completedSale.itemCount,
        completedAt: completedSale.completedAt,
        agentId: agentId,
      });

      if (result.success) {
        setReceiptPrinted(true);
        toast.success("Receipt printed successfully!");
      } else {
        toast.error(
          `Failed to print receipt: ${result.error || "Unknown error"}`
        );
      }
    } catch (error) {
      console.error("Print error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to print receipt"
      );
    }
  };

  const closeCheckoutDialog = () => {
    setCheckoutOpen(false);
    setCompletedSale(null);
    setReceiptPrinted(false);
    resetPayments();
  };

  const handleCheckoutDialogOpenChange = (open: boolean) => {
    if (!open) {
      if (completedSale && !receiptPrinted) {
        if (
          confirm(
            "You haven't printed the receipt. Are you sure you want to close without printing?"
          )
        ) {
          closeCheckoutDialog();
        }
        return;
      }
      closeCheckoutDialog();
    } else {
      if (payments.length === 1) {
        const singlePayment = payments[0];
        setPayments([
          {
            ...singlePayment,
            amount: netTotal,
            ...(singlePayment.method === "Cash"
              ? {
                  amountReceived: netTotal,
                  changeDue: 0,
                }
              : {}),
          },
        ]);
      } else {
        const perPayment = netTotal / payments.length;
        setPayments(
          payments.map((p, i) => ({
            ...p,
            amount:
              i === payments.length - 1
                ? netTotal - perPayment * (payments.length - 1)
                : perPayment,
            ...(p.method === "Cash"
              ? {
                  amountReceived: p.amountReceived || 0,
                  changeDue: 0,
                }
              : {}),
          }))
        );
      }
      setCheckoutOpen(true);
    }
  };

  // Check if printer is configured
  const isPrinterConfigured = !!storePrintSettings?.printAgentId;

  return (
    <POSLayout>
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_380px]">
        {/* Product browser */}
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Point of Sale</h1>
            <p className="text-sm text-muted-foreground">
              {myStore === null
                ? "Select a store, add items to the cart, and check out"
                : "Add items to the cart and check out"}
            </p>
            {storeId && !isPrinterConfigured && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-yellow-50 p-2 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                <Printer className="h-4 w-4" />
                <span>No printer configured. </span>
                <Button
                  variant="link"
                  className="h-auto p-0 text-yellow-800 dark:text-yellow-200"
                  onClick={() => window.location.href = "/admin/store-settings"}
                >
                  Configure now
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {myStore === null ? (
              <Select
                value={storeId || undefined}
                onValueChange={(value) => {
                  setStoreId(value);
                  setCart([]);
                }}
              >
                <SelectTrigger className="sm:w-64">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {activeStores.map((store) => (
                    <SelectItem key={store._id} value={store._id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : myStore ? (
              <div className="flex items-center rounded-md border bg-muted/50 px-3 py-2 text-sm font-medium sm:w-64">
                {myStore.name}
              </div>
            ) : (
              <div className="flex h-10 items-center sm:w-64">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                disabled={!storeId}
              />
            </div>

            <Select
              value={departmentId || "all"}
              onValueChange={(value) =>
                setDepartmentId(value === "all" ? null : value)
              }
            >
              <SelectTrigger className="sm:w-48">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept._id} value={dept._id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!storeId && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <Package className="mb-2 h-8 w-8" />
              <p>
                {myStore === null
                  ? "Select a store to browse available stock"
                  : "Loading your store..."}
              </p>
            </div>
          )}

          {storeId && inventory === undefined && (
            <div className="flex justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {storeId && inventory !== undefined && filteredProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <Package className="mb-2 h-8 w-8" />
              <p>No products match your search</p>
            </div>
          )}

          {storeId && filteredProducts.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((item) => {
                const product = item.product!;
                const cartQtyForProduct = cartQuantityForProduct(
                  item.productId
                );
                const hasVariants = needsVariantPicker(product);

                const priceLabel = (() => {
                  if (!product.sizePricing?.length)
                    return formatCurrency(product.sellingPrice);
                  const prices = product.sizePricing.map(
                    (sp) => sp.sellingPrice
                  );
                  const min = Math.min(...prices);
                  const max = Math.max(...prices);
                  return min === max
                    ? formatCurrency(min)
                    : `${formatCurrency(min)}–${formatCurrency(max)}`;
                })();

                return (
                  <button
                    key={item.productId}
                    type="button"
                    onClick={() => handleProductClick(item)}
                    disabled={cartQtyForProduct >= item.quantity}
                    className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition hover:border-primary hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="line-clamp-2 text-sm font-medium">
                      {product.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {product.sku}
                    </span>
                    <div className="mt-1 flex w-full items-center justify-between">
                      <span className="font-semibold">{priceLabel}</span>
                      <Badge variant="outline" className="text-xs">
                        {item.quantity} in stock
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hasVariants && (
                        <Badge variant="outline" className="text-xs">
                          Select options
                        </Badge>
                      )}
                      {cartQtyForProduct > 0 && (
                        <Badge variant="secondary">
                          {cartQtyForProduct} in cart
                        </Badge>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart panel */}
        <div className="flex h-fit flex-col gap-4 rounded-lg border p-4 lg:sticky lg:top-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShoppingCart className="h-5 w-5" />
              Cart
            </h2>
            {cart.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearCart}>
                Clear
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1 text-sm">
              <User className="h-3 w-3" />
              Customer (Optional)
            </Label>
            <CustomerInput
              value={customerName}
              onChange={setCustomerName}
              disabled={!storeId}
            />
          </div>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {cart.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Cart is empty — click a product to add it
              </p>
            )}

            {cart.map((line) => {
              const key = cartKey(
                line.productId,
                line.size,
                line.color,
                line.variant
              );
              const optionLabel = [line.size, line.color, line.variant]
                .filter(Boolean)
                .join(" / ");
              return (
                <div key={key} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {line.name}
                        {optionLabel && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({optionLabel})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {line.sku}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {line.departmentName}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => removeFromCart(key)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() =>
                          updateCartQuantity(key, line.quantity - 1)
                        }
                        disabled={line.quantity <= 1}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        max={line.availableQuantity}
                        value={line.quantity}
                        onChange={(e) =>
                          updateCartQuantity(key, Number(e.target.value))
                        }
                        className="h-7 w-14 text-center"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() =>
                          updateCartQuantity(key, line.quantity + 1)
                        }
                        disabled={line.quantity >= line.availableQuantity}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">R</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.unitPrice}
                        onChange={(e) =>
                          updateCartPrice(key, Number(e.target.value))
                        }
                        className="h-7 w-20 text-right"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Discount:
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={line.manualDiscount || 0}
                      onChange={(e) =>
                        updateCartDiscount(key, Number(e.target.value))
                      }
                      className="h-7 w-20 text-right"
                    />
                  </div>

                  <p className="text-right text-sm font-medium">
                    {formatCurrency(
                      line.unitPrice * line.quantity -
                        (line.manualDiscount || 0)
                    )}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="space-y-1 border-t pt-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Items</span>
              <span>{cartItemCount}</span>
            </div>
            {discountTotal > 0 && (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(cartTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-green-600">
                  <span>Discounts</span>
                  <span>−{formatCurrency(discountTotal)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatCurrency(netTotal)}</span>
            </div>
          </div>

          <Button
            size="lg"
            className="w-full"
            disabled={cart.length === 0 || !storeId}
            onClick={() => setCheckoutOpen(true)}
          >
            <Receipt className="mr-2 h-4 w-4" />
            Checkout
          </Button>
        </div>
      </div>

      {/* Variant picker dialog */}
      <Dialog open={!!pickerItem} onOpenChange={(open) => !open && closePicker()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select options</DialogTitle>
            <DialogDescription>{pickerItem?.product?.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {pickerItem?.product?.sizes &&
              pickerItem.product.sizes.length > 0 && (
                <div className="space-y-2">
                  <Label>Size</Label>
                  <div className="flex flex-wrap gap-2">
                    {pickerItem.product.sizes.map((size) => (
                      <Button
                        key={size}
                        type="button"
                        size="sm"
                        variant={pickerSize === size ? "default" : "outline"}
                        onClick={() => setPickerSize(size)}
                      >
                        {size}
                        {pickerItem.product!.sizePricing?.find(
                          (sp) => sp.size === size
                        ) && (
                          <span className="ml-1 text-xs opacity-75">
                            ({formatCurrency(
                              pickerItem.product!.sizePricing!.find(
                                (sp) => sp.size === size
                              )!.sellingPrice
                            )})
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

            {pickerItem?.product?.colors &&
              pickerItem.product.colors.length > 0 && (
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex flex-wrap gap-2">
                    {pickerItem.product.colors.map((color) => (
                      <Button
                        key={color}
                        type="button"
                        size="sm"
                        variant={pickerColor === color ? "default" : "outline"}
                        onClick={() => setPickerColor(color)}
                      >
                        {color}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

            {pickerItem?.product?.variants &&
              pickerItem.product.variants.length > 0 && (
                <div className="space-y-2">
                  <Label>Variant</Label>
                  <div className="flex flex-wrap gap-2">
                    {pickerItem.product.variants.map((variant) => (
                      <Button
                        key={variant}
                        type="button"
                        size="sm"
                        variant={
                          pickerVariant === variant ? "default" : "outline"
                        }
                        onClick={() => setPickerVariant(variant)}
                      >
                        {variant}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

            {pickerItem?.product && (
              <p className="text-right text-lg font-semibold">
                {formatCurrency(
                  resolvePrice(pickerItem.product, pickerSize ?? undefined)
                )}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePicker}>
              Cancel
            </Button>
            <Button onClick={confirmPickerSelection}>Add to cart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout / receipt dialog */}
      <Dialog open={checkoutOpen} onOpenChange={handleCheckoutDialogOpenChange}>
        <DialogContent className="max-w-2xl">
          {!completedSale ? (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Sale</DialogTitle>
                <DialogDescription>
                  {cartItemCount} item(s) —{" "}
                  {discountTotal > 0
                    ? `${formatCurrency(cartTotal)} − ${formatCurrency(
                        discountTotal
                      )} discount = `
                    : ""}
                  {formatCurrency(netTotal)} total
                  {customerName.trim()
                    ? ` for ${customerName.trim()}`
                    : " (walk-in)"}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
                {/* Split payment toggle */}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={!isSplitPayment ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setIsSplitPayment(false);
                      setPayments([
                        {
                          method: "Cash",
                          amount: netTotal,
                          amountReceived: netTotal,
                          changeDue: 0,
                        },
                      ]);
                    }}
                  >
                    Single Payment
                  </Button>
                  <Button
                    type="button"
                    variant={isSplitPayment ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setIsSplitPayment(true);
                      const perPayment = netTotal / 2;
                      setPayments([
                        {
                          method: "Cash",
                          amount: perPayment,
                          amountReceived: perPayment,
                          changeDue: 0,
                        },
                        { method: "Mpesa", amount: perPayment },
                      ]);
                    }}
                  >
                    Split Payment
                  </Button>
                </div>

                {/* Payment splits */}
                <div className="space-y-3">
                  {payments.map((payment, index) => (
                    <div key={index} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Select
                            value={payment.method}
                            onValueChange={(value) =>
                              updatePaymentSplit(
                                index,
                                "method",
                                value as PaymentMethod
                              )
                            }
                          >
                            <SelectTrigger className="w-35">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Cash">Cash</SelectItem>
                              <SelectItem value="Card">Card</SelectItem>
                              <SelectItem value="Mpesa">Mpesa</SelectItem>
                              <SelectItem value="Ecocash">Ecocash</SelectItem>
                              <SelectItem value="Bank Transfer">
                                Bank Transfer
                              </SelectItem>
                              <SelectItem value="Mobile Payment">
                                Mobile Payment
                              </SelectItem>
                              <SelectItem value="Credit">Credit</SelectItem>
                              <SelectItem value="Voucher">Voucher</SelectItem>
                            </SelectContent>
                          </Select>
                          {payments.length > 1 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => removePaymentSplit(index)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <span className="text-sm font-medium">
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={payment.amount || ""}
                            onChange={(e) =>
                              updatePaymentSplit(
                                index,
                                "amount",
                                Number(e.target.value)
                              )
                            }
                            className="h-8"
                          />
                        </div>
                        {payment.method === "Cash" && (
                          <>
                            <div>
                              <Label className="text-xs">Received</Label>
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                value={payment.amountReceived || ""}
                                onChange={(e) =>
                                  updatePaymentSplit(
                                    index,
                                    "amountReceived",
                                    Number(e.target.value)
                                  )
                                }
                                className="h-8"
                              />
                            </div>
                            <div className="col-span-2">
                              <Label className="text-xs">Change Due</Label>
                              <Input
                                type="text"
                                value={formatCurrency(payment.changeDue || 0)}
                                disabled
                                className="h-8 bg-muted"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={addPaymentSplit}
                    disabled={payments.length >= 8}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Payment Method
                  </Button>

                  <div className="flex justify-between border-t pt-2">
                    <span className="font-medium">Total Payment:</span>
                    <span
                      className={
                        Math.abs(totalPaymentAmount - netTotal) < 0.01
                          ? "font-medium text-green-600"
                          : "font-medium text-red-600"
                      }
                    >
                      {formatCurrency(totalPaymentAmount)}
                      {Math.abs(totalPaymentAmount - netTotal) >= 0.01 && (
                        <span className="ml-1 text-xs">
                          (Short by{" "}
                          {formatCurrency(netTotal - totalPaymentAmount)})
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCheckoutOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCheckout}
                  disabled={
                    isSubmitting || Math.abs(totalPaymentAmount - netTotal) > 0.01
                  }
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Receipt className="mr-2 h-4 w-4" />
                  )}
                  Confirm Sale
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Sale Complete</DialogTitle>
                <DialogDescription>
                  {completedSale.itemCount} item(s) —{" "}
                  {formatCurrency(completedSale.total)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">Payment:</span>{" "}
                  {completedSale.paymentMethod}
                </p>
                {completedSale.payments.map((p, i) => (
                  <div key={i} className="ml-4 text-xs">
                    <span className="font-medium">{p.method}:</span>{" "}
                    {formatCurrency(p.amount)}
                    {p.method === "Cash" && p.amountReceived && (
                      <span className="text-muted-foreground">
                        {" "}
                        (Received: {formatCurrency(p.amountReceived)}, Change:{" "}
                        {formatCurrency(p.changeDue || 0)})
                      </span>
                    )}
                  </div>
                ))}
                {completedSale.discounts.length > 0 && (
                  <p>
                    <span className="font-medium">Discounts Applied:</span>{" "}
                    {formatCurrency(
                      completedSale.discounts.reduce(
                        (s, d) => s + d.discountAmount,
                        0
                      )
                    )}
                  </p>
                )}
                {completedSale.customerName && (
                  <p>
                    <span className="font-medium">Customer:</span>{" "}
                    {completedSale.customerName}
                  </p>
                )}
                {completedSale.cashierName && (
                  <p>
                    <span className="font-medium">Cashier:</span>{" "}
                    {completedSale.cashierName}
                  </p>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                {receiptPrinted
                  ? "Receipt printed. You can now close this dialog."
                  : "Print the receipt before closing, or close without printing."}
              </p>

              <DialogFooter className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={closeCheckoutDialog}
                  className="sm:order-1"
                >
                  {receiptPrinted ? "Close" : "Close Without Printing"}
                </Button>
                <Button
                  onClick={handlePrint}
                  variant={receiptPrinted ? "outline" : "default"}
                  className="sm:order-2"
                >
                  <Receipt className="mr-2 h-4 w-4" />
                  {receiptPrinted ? "Print Again" : "Print Receipt"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </POSLayout>
  );
}