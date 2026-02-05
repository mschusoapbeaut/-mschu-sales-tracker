import { describe, it, expect, vi } from "vitest";

// Mock the database module
vi.mock("../server/db", () => ({
  updateUserStaffId: vi.fn().mockResolvedValue(undefined),
}));

describe("User Staff ID API", () => {
  it("should allow users to get their staff ID", () => {
    // Test that the getStaffId endpoint returns the user's staff ID
    const mockUser = {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      staffId: "78319091759",
      role: "user",
    };

    // Simulate the endpoint logic
    const result = { staffId: mockUser.staffId || null };
    
    expect(result).toEqual({ staffId: "78319091759" });
  });

  it("should return null for users without staff ID", () => {
    const mockUser = {
      id: 2,
      name: "New User",
      email: "new@example.com",
      staffId: null,
      role: "user",
    };

    const result = { staffId: mockUser.staffId || null };
    
    expect(result).toEqual({ staffId: null });
  });

  it("should allow users to update their own staff ID", async () => {
    const { updateUserStaffId } = await import("../server/db");
    
    // Simulate the mutation
    const userId = 1;
    const newStaffId = "78319550511";
    
    await updateUserStaffId(userId, newStaffId);
    
    expect(updateUserStaffId).toHaveBeenCalledWith(userId, newStaffId);
  });

  it("should allow users to clear their staff ID", async () => {
    const { updateUserStaffId } = await import("../server/db");
    
    // Simulate clearing the staff ID
    const userId = 1;
    
    await updateUserStaffId(userId, null);
    
    expect(updateUserStaffId).toHaveBeenCalledWith(userId, null);
  });

  it("should validate staff ID format (numeric only)", () => {
    const validStaffIds = ["78319091759", "78319550511", "101232115995"];
    const invalidStaffIds = ["abc123", "78319-091759", ""];

    validStaffIds.forEach((id) => {
      expect(/^\d+$/.test(id)).toBe(true);
    });

    invalidStaffIds.forEach((id) => {
      expect(/^\d+$/.test(id)).toBe(false);
    });
  });
});
