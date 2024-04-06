
export interface HealthPurchases 
{
    [sessionId: string]: HealthPurchaseRecord[];
}

export interface HealthPurchaseRecord 
{
    headHealthPurchases: number;
    chestHealthPurchases: number;
    stomachHealthPurchases: number;
    leftArmHealthPurchases: number;
    rightArmHealthPurchases: number;
    leftLegHealthPurchases: number;
    rightLegHealthPurchases: number;
    
    weightLimitIncreasePurchases: number;
}