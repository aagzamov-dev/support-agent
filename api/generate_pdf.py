from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import sys

def create_pdf(filename):
    c = canvas.Canvas(filename, pagesize=letter)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(100, 750, "Global Sales Playbook 2026")
    
    c.setFont("Helvetica", 12)
    c.drawString(100, 700, "1. Enterprise Client Strategy:")
    c.drawString(120, 680, "- For clients over $50k MRR, always involve a Senior Account Executive.")
    c.drawString(120, 660, "- Offer a complimentary 12-month Service Level Agreement (SLA) on all enterprise deals.")
    
    c.drawString(100, 620, "2. Upselling Support Tiers:")
    c.drawString(120, 600, "- Basic support is free. Premium support is $99/user/month.")
    c.drawString(120, 580, "- Premium support guarantees a 1-hour response time and a dedicated Slack channel.")
    
    c.drawString(100, 540, "3. Objection Handling - High Costs:")
    c.drawString(120, 520, "- If a prospect says it's too expensive, emphasize our 99.99% uptime guarantee.")
    c.drawString(120, 500, "- You are authorized to provide a one-time 15% discount code: SAVE15B2B.")
    
    c.showPage()
    
    # Page 2
    c.setFont("Helvetica-Bold", 16)
    c.drawString(100, 750, "Sales Commission Structure")
    
    c.setFont("Helvetica", 12)
    c.drawString(100, 700, "- Base commission is 8% of the first year's contract value.")
    c.drawString(100, 680, "- Multi-year contracts receive an upfront 12% commission.")
    c.drawString(100, 660, "- Quota achievement multiplier: If you exceed 120% of quota, commission bumps to 15%.")
    
    c.save()

if __name__ == "__main__":
    create_pdf("Sales_Playbook_2026.pdf")
    print("PDF created successfully!")
