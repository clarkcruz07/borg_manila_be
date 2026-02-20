const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		employeeId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "employee_details",
			required: true,
		},
		leaveType: {
			type: String,
			enum: ["vacation", "sick"],
			required: true,
		},
		startDate: {
			type: Date,
			required: true,
		},
		endDate: {
			type: Date,
			required: true,
		},
		numberOfDays: {
			type: Number,
			required: true,
		},
		reason: {
			type: String,
			required: true,
		},
		status: {
			type: String,
			enum: ["pending", "approved", "rejected", "cancelled"],
			default: "pending",
		},
		approvedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: false,
		},
		approvedAt: {
			type: Date,
			required: false,
		},
		rejectionReason: {
			type: String,
			required: false,
		},
		attachments: {
			type: [String],
			default: [],
		},
		createdAt: {
			type: Date,
			default: Date.now,
		},
		updatedAt: {
			type: Date,
			default: Date.now,
		},
		pendingDeduction: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true }
);

leaveSchema.index({ userId: 1, status: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model("Leave", leaveSchema);
