"""
CSV Builder Script
Combines discovery, validation, and contact data into CRM-ready CSV.
"""

import csv
import json
from datetime import datetime
from typing import List, Dict


class CSVBuilder:
    """Build CRM-ready CSV output from reconnaissance data."""
    
    def __init__(self, output_path: str = "contact_list.csv"):
        self.output_path = output_path
        self.fieldnames = [
            'business_name',
            'website',
            'phone',
            'email',
            'contact_name',
            'title',
            'linkedin_url',
            'source',
            'confidence',
            'last_verified',
            'notes',
            'region',
            'industry'
        ]
    
    def merge_data(self, 
                   discovered: List[Dict],
                   validated: Dict,
                   contacts: Dict) -> List[Dict]:
        """
        Merge data from all phases into unified records.
        
        Args:
            discovered: From discovery phase
            validated: Dict keyed by website, validation results
            contacts: Dict keyed by website, contact data
        """
        merged = []
        
        for business in discovered:
            website = business.get('website', '')
            key = website.replace('https://', '').rstrip('/')
            
            record = {
                'business_name': business.get('business_name', ''),
                'website': website,
                'region': business.get('region', ''),
                'industry': business.get('industry', ''),
                'source': business.get('search_query', 'web_search'),
            }
            
            # Add validation data
            if key in validated:
                val = validated[key]
                record['confidence'] = val.get('confidence_score', 0)
                record['notes'] = f"Active: {val.get('is_active', False)}, Score: {val.get('confidence_score', 0)}"
            
            # Add contact data
            if key in contacts:
                ct = contacts[key]
                record['phone'] = ', '.join(ct.get('phones', [])[:2])
                record['email'] = ', '.join(ct.get('emails', [])[:2])
                record['notes'] += f" | Contact page: {ct.get('contact_page', 'N/A')}"
            
            # Add timestamp
            record['last_verified'] = datetime.now().strftime('%Y-%m-%d')
            
            merged.append(record)
        
        return merged
    
    def write_csv(self, data: List[Dict], filepath: str = None) -> str:
        """
        Write data to CSV file.
        
        Args:
            data: List of record dictionaries
            filepath: Override output path (uses default if None)
        """
        out_path = filepath or self.output_path
        
        with open(out_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=self.fieldnames)
            writer.writeheader()
            writer.writerows(data)
        
        return out_path
    
    def write_json(self, data: List[Dict], filepath: str = None) -> str:
        """Write data to JSON for backup/analysis."""
        out_path = filepath or self.output_path.replace('.csv', '.json')
        
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, default=str)
        
        return out_path
    
    def filter_by_confidence(self, data: List[Dict], 
                            min_score: float = 50.0) -> List[Dict]:
        """Filter records by minimum confidence score."""
        return [
            r for r in data 
            if float(r.get('confidence', 0)) >= min_score
        ]
    
    def generate_summary(self, data: List[Dict]) -> Dict:
        """Generate summary statistics for the contact list."""
        if not data:
            return {}
        
        total = len(data)
        with_email = sum(1 for r in data if r.get('email'))
        with_phone = sum(1 for r in data if r.get('phone'))
        high_conf = sum(1 for r in data if float(r.get('confidence', 0)) >= 70)
        
        return {
            'total_records': total,
            'with_email': with_email,
            'with_phone': with_phone,
            'high_confidence': high_conf,
            'email_coverage': f"{with_email/total*100:.1f}%" if total else "0%",
            'phone_coverage': f"{with_phone/total*100:.1f}%" if total else "0%",
            'generated_at': datetime.now().isoformat()
        }


def main():
    """Example usage."""
    builder = CSVBuilder()
    
    # Sample data (would come from other scripts)
    sample_data = [
        {
            'business_name': 'Test Business',
            'website': 'https://test.com',
            'phone': '555-0123',
            'email': 'test@test.com',
            'confidence': 85,
            'region': 'Austin, TX',
            'industry': 'plumber'
        }
    ]
    
    out_path = builder.write_csv(sample_data)
    summary = builder.generate_summary(sample_data)
    
    print(f"CSV written to: {out_path}")
    print(f"Summary: {summary}")


if __name__ == "__main__":
    main()
